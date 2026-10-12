import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

function block(selector: string) {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error("Missing CSS selector: " + selector);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

function token(source: string, name: string) {
  const match = source.match(new RegExp("--" + name + "\\s*:\\s*(#[0-9a-fA-F]{6})"));
  if (!match) throw new Error("Missing hexadecimal token: --" + name);
  return match[1];
}

function luminance(hex: string) {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(foreground: string, background: string) {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("premium design system", () => {
  it("keeps core dark-theme semantic colors at WCAG AA text contrast", () => {
    const root = block(":root");
    const background = token(root, "bg");
    for (const name of ["text", "muted", "accent", "accent2", "danger", "warning"]) {
      expect(contrast(token(root, name), background), name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps core light-theme semantic colors at WCAG AA text contrast", () => {
    const light = block('html[data-theme="light"]');
    const background = token(light, "bg");
    for (const name of ["text", "muted", "accent", "accent2", "danger", "warning"]) {
      expect(contrast(token(light, name), background), name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("uses tabular lining figures for high-value financial numbers", () => {
    expect(css).toContain("font-variant-numeric:tabular-nums lining-nums");
    expect(css).toContain('font-feature-settings:"tnum" 1,"lnum" 1');
  });

  it("keeps a visible keyboard focus ring for fields inside the signed-in shells", () => {
    expect(block(".field input,.field select,.field textarea")).not.toMatch(/outline\s*:\s*(none|0)\b/);
    expect(css).toContain(".app-shell :where(input,select,textarea,button,a,summary,[tabindex]):focus-visible");
  });

  it("does not fade signed-in content in on every page entry", () => {
    expect(css).not.toContain("premium-rise");
  });
});
