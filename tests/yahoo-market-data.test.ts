import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { getMarketDataProvider } from "../src/lib/market-data";
import { YahooMarketDataProvider, isAllowedYahooSymbol, normaliseYahooCurrency } from "../src/lib/yahoo-market-data";
import { SETTINGS, settingByKey, validateSetting } from "../src/domain/settings-registry";
import { checkCommercialLaunch, marketDataProviderWarnings, YAHOO_LAUNCH_WARNING } from "../src/domain/commercial-launch";

const NOW = new Date("2026-10-12T12:00:00Z");
const nowSeconds = Math.floor(NOW.getTime() / 1000);

function chartBody(meta: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { chart: { result: [{ meta, ...extra }], error: null } };
}
function stubFetch(body: unknown, status = 200) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("YahooMarketDataProvider.currentPrice", () => {
  const provider = new YahooMarketDataProvider();
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("converts pence (GBp) to pounds exactly with Decimal", async () => {
    stubFetch(chartBody({ regularMarketPrice: 12345.6, regularMarketTime: nowSeconds - 60, currency: "GBp" }));
    const quote = await provider.currentPrice("VWRL.L", NOW);
    expect(quote).toMatchObject({ price: "123.456", currency: "GBP", provider: "yahoo", priceKind: "LAST", granularity: "TRADE" });
    expect(quote?.observedAt.getTime()).toBe((nowSeconds - 60) * 1000);
  });

  it("treats GBX as pence and passes other three-letter codes through uppercased", async () => {
    stubFetch(chartBody({ regularMarketPrice: 250, regularMarketTime: nowSeconds, currency: "GBX" }));
    expect((await provider.currentPrice("A.L", NOW))?.price).toBe("2.5");
    stubFetch(chartBody({ regularMarketPrice: 71.23, regularMarketTime: nowSeconds, currency: "USD" }));
    expect(await provider.currentPrice("TQQQ", NOW)).toMatchObject({ price: "71.23", currency: "USD" });
  });

  it("returns null for unknown subunits and malformed currencies instead of guessing", async () => {
    for (const currency of ["ZAc", "ZAC", "ILA", "gBp", "EURO", "", "US"]) {
      stubFetch(chartBody({ regularMarketPrice: 10, regularMarketTime: nowSeconds, currency }));
      expect(await provider.currentPrice("X", NOW), currency).toBeNull();
    }
    stubFetch(chartBody({ regularMarketPrice: 10, regularMarketTime: nowSeconds }));
    expect(await provider.currentPrice("X", NOW)).toBeNull();
  });

  it("never sets corporateActionsAdjusted", async () => {
    stubFetch(chartBody({ regularMarketPrice: 10, regularMarketTime: nowSeconds, currency: "USD" }));
    const quote = await provider.currentPrice("X", NOW);
    expect(quote).not.toBeNull();
    expect(quote?.corporateActionsAdjusted).toBeUndefined();
  });

  it("returns null for chart.error, empty result, 404 and missing price", async () => {
    stubFetch({ chart: { result: null, error: { code: "Not Found", description: "No data found" } } });
    expect(await provider.currentPrice("X", NOW)).toBeNull();
    stubFetch({ chart: { result: [], error: null } });
    expect(await provider.currentPrice("X", NOW)).toBeNull();
    stubFetch({ chart: { result: null, error: { code: "Not Found" } } }, 404);
    expect(await provider.currentPrice("X", NOW)).toBeNull();
    stubFetch(chartBody({ regularMarketTime: nowSeconds, currency: "USD" }));
    expect(await provider.currentPrice("X", NOW)).toBeNull();
  });

  it("throws MARKET_DATA_HTTP_<status> for 429 and 5xx", async () => {
    stubFetch({}, 429);
    await expect(provider.currentPrice("X", NOW)).rejects.toThrow("MARKET_DATA_HTTP_429");
    stubFetch({}, 500);
    await expect(provider.currentPrice("X", NOW)).rejects.toThrow("MARKET_DATA_HTTP_500");
  });

  it("rejects non-positive prices and timestamps more than five minutes in the future", async () => {
    stubFetch(chartBody({ regularMarketPrice: 0, regularMarketTime: nowSeconds, currency: "USD" }));
    expect(await provider.currentPrice("X", NOW)).toBeNull();
    stubFetch(chartBody({ regularMarketPrice: -3, regularMarketTime: nowSeconds, currency: "USD" }));
    expect(await provider.currentPrice("X", NOW)).toBeNull();
    stubFetch(chartBody({ regularMarketPrice: 5, regularMarketTime: nowSeconds + 10 * 60, currency: "USD" }));
    expect(await provider.currentPrice("X", NOW)).toBeNull();
    stubFetch(chartBody({ regularMarketPrice: 5, regularMarketTime: nowSeconds + 60, currency: "USD" }));
    expect(await provider.currentPrice("X", NOW)).not.toBeNull();
  });

  it("rejects unsafe symbols before any request is made", async () => {
    const fn = stubFetch(chartBody({ regularMarketPrice: 5, regularMarketTime: nowSeconds, currency: "USD" }));
    for (const symbol of ["A/B", "..", "A..B", "A B", "A?x=1", "", "A".repeat(25), "../etc"]) {
      expect(await provider.currentPrice(symbol, NOW), symbol).toBeNull();
    }
    expect(fn).not.toHaveBeenCalled();
    expect(isAllowedYahooSymbol("VWRL.L")).toBe(true);
    expect(isAllowedYahooSymbol("^FTSE")).toBe(true);
    expect(isAllowedYahooSymbol("GBPUSD=X")).toBe(true);
  });

  it("calls the https chart endpoint with safe fetch options", async () => {
    const fn = stubFetch(chartBody({ regularMarketPrice: 5, regularMarketTime: nowSeconds, currency: "USD" }));
    await provider.currentPrice("^FTSE", NOW);
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.startsWith("https://query1.finance.yahoo.com/v8/finance/chart/%5EFTSE?")).toBe(true);
    expect(url).toContain("range=5d");
    expect(url).toContain("interval=1d");
    expect(url).toContain("includePrePost=false");
    expect(init.redirect).toBe("error");
    expect(init.cache).toBe("no-store");
    expect((init.headers as Record<string, string>)["user-agent"]).toBeTruthy();
  });
});

describe("YahooMarketDataProvider.historicalPrice", () => {
  const provider = new YahooMarketDataProvider();
  afterEach(() => vi.unstubAllGlobals());
  const day = 86_400;
  const base = Math.floor(new Date("2026-10-05T08:00:00Z").getTime() / 1000);

  it("picks the last daily bar close at or before the requested instant and ignores null closes", async () => {
    stubFetch(chartBody(
      { currency: "GBp" },
      { timestamp: [base, base + day, base + 2 * day, base + 3 * day], indicators: { quote: [{ close: [100, 200, null, 400] }] } }
    ));
    const at = new Date((base + 2 * day + 3600) * 1000); // after bar 3 (null), before bar 4
    const quote = await provider.historicalPrice("VWRL.L", at, NOW);
    expect(quote).toMatchObject({ price: "2", currency: "GBP", priceKind: "CLOSE", granularity: "DAILY_BAR", provider: "yahoo" });
    expect(quote?.observedAt.getTime()).toBe((base + day) * 1000);
    expect(quote?.corporateActionsAdjusted).toBeUndefined();
  });

  it("returns null when no bar exists at or before the instant", async () => {
    stubFetch(chartBody({ currency: "USD" }, { timestamp: [base + day], indicators: { quote: [{ close: [10] }] } }));
    expect(await provider.historicalPrice("X", new Date(base * 1000), NOW)).toBeNull();
  });

  it("rejects unsafe symbols without calling fetch", async () => {
    const fn = stubFetch({});
    expect(await provider.historicalPrice("a/b", new Date(base * 1000), NOW)).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("normaliseYahooCurrency", () => {
  it("maps pence and fails closed on other subunits", () => {
    expect(normaliseYahooCurrency("GBp")).toEqual({ code: "GBP", hundredths: true });
    expect(normaliseYahooCurrency("GBX")).toEqual({ code: "GBP", hundredths: true });
    expect(normaliseYahooCurrency("GBP")).toEqual({ code: "GBP", hundredths: false });
    expect(normaliseYahooCurrency("ZAc")).toBeNull();
    expect(normaliseYahooCurrency("ILA")).toBeNull();
  });
});

describe("provider selection and settings", () => {
  const saved = process.env.MARKET_DATA_PROVIDER;
  afterEach(() => {
    if (saved === undefined) delete process.env.MARKET_DATA_PROVIDER;
    else process.env.MARKET_DATA_PROVIDER = saved;
  });

  it("selects yahoo only when explicitly configured", () => {
    process.env.MARKET_DATA_PROVIDER = "yahoo";
    const provider = getMarketDataProvider();
    expect(provider.name).toBe("yahoo");
    expect(provider.configured).toBe(true);
    delete process.env.MARKET_DATA_PROVIDER;
    expect(getMarketDataProvider().name).toBe("unconfigured");
    process.env.MARKET_DATA_PROVIDER = "Yahoo ";
    expect(getMarketDataProvider().configured).toBe(false);
  });

  it("registry accepts yahoo, still rejects arbitrary values, and the help is honest about licensing", () => {
    const def = settingByKey("MARKET_DATA_PROVIDER")!;
    expect(validateSetting(def, "yahoo").ok).toBe(true);
    expect(validateSetting(def, "http").ok).toBe(true);
    expect(validateSetting(def, "bloomberg").ok).toBe(false);
    expect(def.help).toMatch(/not licensed|NOT licensed/);
    expect(SETTINGS.filter((s) => s.key === "MARKET_DATA_PROVIDER")).toHaveLength(1);
  });
});

describe("launch warning", () => {
  it("is raised for yahoo and keeps the market data launch gate failing", () => {
    expect(marketDataProviderWarnings({ MARKET_DATA_PROVIDER: "yahoo" })).toEqual([YAHOO_LAUNCH_WARNING]);
    expect(YAHOO_LAUNCH_WARNING).toContain("unofficial, not licensed for commercial redistribution");
    expect(marketDataProviderWarnings({ MARKET_DATA_PROVIDER: "http" })).toEqual([]);
    const gate = checkCommercialLaunch({ MARKET_DATA_PROVIDER: "yahoo" }).find((c) => c.key === "market_data_mode")!;
    expect(gate.passed).toBe(false);
    expect(gate.reason).toBe(YAHOO_LAUNCH_WARNING);
  });

  it("is rendered on the admin launch page", () => {
    const page = readFileSync(new URL("../src/app/admin/launch/page.tsx", import.meta.url), "utf8");
    expect(page).toContain("marketDataProviderWarnings(process.env)");
  });
});
