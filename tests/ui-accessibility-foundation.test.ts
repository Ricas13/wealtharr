import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Field } from "../src/components/Field";
import { InlineMessage, messageRole } from "../src/components/InlineMessage";
import { dateShort, dateTime, money, pct, qty } from "../src/lib/format";
import { NETWORK_ERROR_TEXT, UNEXPECTED_RESPONSE_TEXT, postJson, requestJson } from "../src/lib/http";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const css = read("src/app/globals.css");

describe("InlineMessage", () => {
  it("announces errors and warnings as alerts and successes and info politely", () => {
    expect(messageRole("error")).toBe("alert");
    expect(messageRole("warning")).toBe("alert");
    expect(messageRole("success")).toBe("status");
    expect(messageRole("info")).toBe("status");
    const error = renderToStaticMarkup(createElement(InlineMessage, { tone: "error" } as Parameters<typeof InlineMessage>[0], "Nope"));
    expect(error).toContain('role="alert"');
    expect(error).toContain('class="error"');
    const success = renderToStaticMarkup(createElement(InlineMessage, { tone: "success" } as Parameters<typeof InlineMessage>[0], "Saved"));
    expect(success).toContain('role="status"');
    expect(success).toContain('class="success"');
    const warning = renderToStaticMarkup(createElement(InlineMessage, { tone: "warning" } as Parameters<typeof InlineMessage>[0], "Check"));
    expect(warning).toContain('role="alert"');
    expect(warning).toContain("attention-message");
  });
});

describe("Field", () => {
  it("renders exactly the label and control when help and error are absent", () => {
    const html = renderToStaticMarkup(createElement(Field, { label: "Email" } as Parameters<typeof Field>[0], createElement("input", { name: "email" })));
    expect(html).not.toContain("aria-describedby");
    expect(html).not.toContain("aria-invalid");
    expect(html).not.toContain('class="help"');
    expect(html).not.toContain('role="alert"');
    const id = /for="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`id="${id}"`);
    expect(html).toContain('name="email"');
  });

  it("links help and error text to the control and marks it invalid", () => {
    const html = renderToStaticMarkup(createElement(Field, {
      label: "Price",
      help: "In pence",
      error: "Required"
    } as Parameters<typeof Field>[0], createElement("div", { className: "prefix" }, createElement("input", { name: "price" }))));
    const id = /for="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain('id="' + id + '"');
    expect(html).toContain('aria-describedby="' + id + "-help " + id + '-error"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('id="' + id + '-error"');
    expect(html).toContain('role="alert"');
  });

  it("keeps an id the caller already set and appends to an existing description", () => {
    const html = renderToStaticMarkup(createElement(Field, {
      label: "Code",
      help: "Six digits"
    } as Parameters<typeof Field>[0], createElement("input", { id: "own-id", "aria-describedby": "other" })));
    expect(html).toContain('for="own-id"');
    expect(html).toContain('aria-describedby="other own-id-help"');
    expect(html).not.toContain("aria-invalid");
  });
});

describe("formatting helpers", () => {
  it("formats money with pence and an explicit sign for gains and losses", () => {
    expect(money(1234.5, "GBP")).toBe("£1,234.50");
    expect(money(1234.5, "GBP", { signed: true })).toBe("+£1,234.50");
    expect(money(-1234.5, "GBP", { signed: true })).toMatch(/^[-−]£1,234\.50$/);
    expect(money(0, "GBP", { signed: true })).toBe("£0.00");
    expect(money(1234.4, "GBP", { dp: 0 })).toBe("£1,234");
    expect(money(null, "GBP")).toBe("—");
    expect(money("not a number", "GBP")).toBe("—");
  });

  it("formats percentages and quantities", () => {
    expect(pct(12.3, { signed: true })).toBe("+12.30%");
    expect(pct(-4.5)).toMatch(/^[-−]4\.50%$/);
    expect(pct(0, { signed: true })).toBe("0.00%");
    expect(qty(1.5)).toBe("1.5");
    expect(qty(1000.123456789)).toBe("1,000.123457");
    expect(qty(undefined)).toBe("—");
  });

  it("formats dates in en-GB, keeping date-only strings on their calendar day", () => {
    expect(dateShort("2026-10-12")).toBe("12 Oct 2026");
    expect(dateShort("2026-10-12T23:30:00Z", "Europe/London")).toBe("13 Oct 2026");
    const stamp = dateTime("2026-10-12T13:05:00Z", "Europe/London");
    expect(stamp).toContain("12 Oct 2026");
    expect(stamp).toContain("14:05");
    expect(dateShort("garbage")).toBe("—");
  });
});

describe("requestJson / postJson", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("returns parsed data on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "x" }), { status: 200 })));
    const result = await postJson("/api/x", { a: 1 });
    expect(result).toMatchObject({ ok: true, status: 200, data: { id: "x" }, errorText: "" });
  });

  it("uses the server's error message and falls back when there is none", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Too many requests" }), { status: 429 })));
    expect((await postJson("/api/x")).errorText).toBe("Too many requests");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 400 })));
    expect((await postJson("/api/x", undefined, { fallbackError: "Could not save." })).errorText).toBe("Could not save.");
  });

  it("never throws for non-JSON bodies or network failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>502</html>", { status: 502 })));
    const bad = await requestJson("/api/x", { method: "PATCH", body: {} });
    expect(bad).toMatchObject({ ok: false, status: 502, errorText: UNEXPECTED_RESPONSE_TEXT });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const offline = await postJson("/api/x");
    expect(offline).toMatchObject({ ok: false, status: 0, errorText: NETWORK_ERROR_TEXT });
  });

  it("only sends a content-type header when there is a body", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await postJson("/api/x");
    await postJson("/api/x", { a: 1 });
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0][1].headers).toEqual({});
    expect(calls[1][1].headers).toEqual({ "content-type": "application/json" });
  });
});

describe("migrated forms", () => {
  const forms = ["src/components/StrategyActions.tsx", "src/components/AuthForms.tsx", "src/components/SettingsForms.tsx", "src/components/AdminEditors.tsx"];

  it("never parse a response body without a safety net", () => {
    for (const file of forms) {
      const source = read(file);
      expect(source, file).not.toMatch(/await\s+\w+\.json\(\)(?!\.catch)/);
      // MFA and account deletion retain explicit fetch-based reauth handling.
      if(file!=="src/components/SettingsForms.tsx")expect(source,file).not.toMatch(/\bfetch\(/);
    }
  });

  it("decide success or error from state, not from the wording of a message", () => {
    for (const file of forms) {
      const source = read(file);
      expect(source, file).not.toMatch(/message\.(startsWith|includes)\(/);
      expect(source, file).not.toMatch(/\.includes\("Recalculation needs attention"\)/);
    }
  });

  it("no longer asks the browser to confirm account deletion", () => {
    expect(read("src/components/SettingsForms.tsx")).not.toMatch(/\bconfirm\(/);
  });

  it("labels the trade price, quantity and fee with visible text instead of placeholders", () => {
    const source = read("src/components/StrategyActions.tsx");
    expect(source).not.toContain('placeholder="Execution price"');
    expect(source).not.toContain('placeholder="Actual quantity"');
    expect(source).toContain('label="Quantity (shares)"');
    expect(source).toMatch(/label=\{currency \? "Fee \(" \+ currency/);
  });

  it("exposes the what-if scenario switch as a radio group", () => {
    const source = read("src/components/StrategyActions.tsx");
    expect(source).toContain('role="radiogroup"');
    expect(source).toContain('role="radio"');
    expect(source).toContain("aria-checked");
    expect(source).toContain("ArrowRight");
  });
});

describe("shell and page copy", () => {
  it("drives the status bar from data instead of a fixed sentence", () => {
    const shell = read("src/components/AppShell.tsx");
    expect(shell).not.toContain("Your strategies are being tracked");
    expect(shell).toContain("trackingStatusText");
    expect(read("src/app/app/layout.tsx")).toContain("tracking={tracking}");
  });

  it("tells screen readers which notifications are unread", () => {
    const page = read("src/app/app/notifications/page.tsx");
    expect(page).toMatch(/activity-unread"><span className="sr-only">Unread<\/span>/);
  });

  it("counts due actions in the dashboard heading", () => {
    const page = read("src/app/app/page.tsx");
    expect(page).not.toContain("One thing needs your attention");
    expect(page).toContain("actions due");
  });

  it("gives the admin area its own loading and error states", () => {
    expect(read("src/app/admin/loading.tsx")).toContain("aria-busy");
    expect(read("src/app/admin/error.tsx")).toContain('role="alert"');
  });

  it("keeps the public demo chart's pixel-pinned appearance", () => {
    expect(read("src/app/demo/page.tsx")).toContain("pinnedAppearance");
  });
});

describe("stylesheet hygiene", () => {
  it("never removes the focus outline from form fields or anything inside the app shells", () => {
    const offenders: string[] = [];
    for (const rule of css.split("}")) {
      const open = rule.indexOf("{");
      if (open < 0) continue;
      const selector = rule.slice(0, open);
      const body = rule.slice(open + 1);
      if (!/outline\s*:\s*(none|0)\b/.test(body)) continue;
      if (/\.field|\.app-shell|workspace-shell|\.focus-action|\.correction-inline|\.quick-drawer-content|\.chart-date-range|\.admin-search/.test(selector)) offenders.push(selector.trim());
    }
    expect(offenders).toEqual([]);
    expect(css).toMatch(/\.app-shell :where\(input,select,textarea,button,a,summary,\[tabindex\]\):focus-visible\s*\{\s*outline:2px solid var\(--accent\)/);
  });

  it("has no references to retired selectors or undefined tokens", () => {
    for (const retired of [
      ".portfolio-shell", ".admin-overview-hero", ".admin-overview-metric", ".admin-overview-panel", ".admin-quick-start",
      ".admin-strategy-tile", ".admin-catalogue-grid", ".admin-tile-", ".action-queue", ".action-row", ".portfolio-kpi-card", "premium-rise"
    ]) expect(css, retired).not.toContain(retired);
    expect(css).not.toContain("var(--surface)");
    for (const kept of [".portfolio-panel", ".portfolio-data-table", ".portfolio-secondary-kpis", ".customer-workspace-shell .portfolio-strategies-workspace"]) {
      expect(css, kept).toContain(kept);
    }
  });

  it("styles the settings, privacy, explore and trade-time hooks the markup uses", () => {
    for (const hook of [".settings-grid", ".settings-card-heading", ".privacy-card", ".explore-card", ".trade-execution-when"]) {
      expect(css, hook).toContain(hook);
    }
  });

  it("declares the reduced-motion preference once for the whole document", () => {
    const universal = css.match(/\*,\s*\*::before,\s*\*::after\s*\{[^}]*animation-duration/g) ?? [];
    expect(universal).toHaveLength(1);
  });
});
