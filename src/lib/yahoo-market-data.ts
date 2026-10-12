import "server-only";
import Decimal from "decimal.js";
import { z } from "zod";
import type { MarketDataProvider, PriceObservation } from "@/lib/market-data";

/**
 * Yahoo Finance chart provider.
 *
 * LICENSING: Yahoo's public chart endpoints are unofficial and undocumented, are not licensed for
 * commercial redistribution, and may break or be rate-limited without notice. This provider exists
 * because the owner chose it explicitly. It never asserts `corporateActionsAdjusted`, so the
 * momentum history gate (MARKET_DATA_HISTORY_ADJUSTED_LICENSED) can never be satisfied by it.
 */

export const YAHOO_CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart/";
export const YAHOO_PROVIDER_NAME = "yahoo";
const USER_AGENT = "Wealtharr-market-data/1.0 (portfolio rebalancing app; unofficial Yahoo chart client)";
const FUTURE_TOLERANCE_MS = 5 * 60_000;
const DAY_SECONDS = 86_400;

// Letters, digits and the few punctuation characters real Yahoo symbols use (e.g. VWRL.L, ^FTSE, GBPUSD=X).
const SYMBOL_PATTERN = /^[A-Za-z0-9.^=-]{1,24}$/;

export function isAllowedYahooSymbol(symbol: string) {
  return typeof symbol === "string" && SYMBOL_PATTERN.test(symbol) && !symbol.includes("..");
}

// Subunit codes that are three letters and would otherwise be mistaken for a major currency.
const UNSUPPORTED_SUBUNITS = new Set(["ILA", "ZAC"]);

/**
 * Returns the ISO currency and whether the quoted price is in hundredths (pence) of it.
 * GBp/GBX (LSE pence) are converted by the caller; every other subunit or malformed code fails closed.
 */
export function normaliseYahooCurrency(raw: unknown): { code: string; hundredths: boolean } | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value === "GBp") return { code: "GBP", hundredths: true };
  if (/^[A-Z]{3}$/.test(value) || /^[a-z]{3}$/.test(value)) {
    const code = value.toUpperCase();
    if (code === "GBX") return { code: "GBP", hundredths: true };
    if (UNSUPPORTED_SUBUNITS.has(code)) return null;
    return { code, hundredths: false };
  }
  return null; // mixed case ("ZAc"), wrong length or non-letters: unknown subunit, do not guess
}

const resultSchema = z.object({
  meta: z.object({
    regularMarketPrice: z.number().optional().nullable(),
    regularMarketTime: z.number().optional().nullable(),
    currency: z.string().optional().nullable()
  }).passthrough(),
  timestamp: z.array(z.number()).optional().nullable(),
  indicators: z.object({
    quote: z.array(z.object({ close: z.array(z.number().nullable()).optional().nullable() }).passthrough()).optional().nullable()
  }).passthrough().optional().nullable()
}).passthrough();

const payloadSchema = z.object({
  chart: z.object({
    result: z.array(resultSchema).optional().nullable(),
    error: z.unknown().optional().nullable()
  }).passthrough()
}).passthrough();

type ChartResult = z.infer<typeof resultSchema>;

function toObservation(rawPrice: number, rawCurrency: unknown, epochSeconds: number, priceKind: "LAST" | "CLOSE", granularity: "TRADE" | "DAILY_BAR", now: Date): PriceObservation | null {
  if (!Number.isFinite(rawPrice) || !Number.isFinite(epochSeconds)) return null;
  const currency = normaliseYahooCurrency(rawCurrency);
  if (!currency) return null;
  let price = new Decimal(String(rawPrice));
  if (!price.isFinite() || price.lte(0)) return null;
  if (currency.hundredths) price = price.div(100);
  const observedAt = new Date(epochSeconds * 1000);
  if (!Number.isFinite(observedAt.getTime())) return null;
  if (observedAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) return null;
  // corporateActionsAdjusted is deliberately left undefined: Yahoo makes no licensed adjustment assertion.
  return { price: price.toString(), currency: currency.code, observedAt, provider: YAHOO_PROVIDER_NAME, granularity, priceKind };
}

export class YahooMarketDataProvider implements MarketDataProvider {
  name = YAHOO_PROVIDER_NAME;
  configured = true;

  private async fetchChart(providerSymbol: string, query: string): Promise<ChartResult | null> {
    if (!isAllowedYahooSymbol(providerSymbol)) return null;
    const url = YAHOO_CHART_BASE + encodeURIComponent(providerSymbol) + "?" + query + "&includePrePost=false";
    const response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": USER_AGENT },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000)
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("MARKET_DATA_HTTP_" + response.status);
    const parsed = payloadSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error("MARKET_DATA_INVALID_RESPONSE");
    const chart = parsed.data.chart;
    if (chart.error) return null;
    const first = chart.result?.[0];
    return first ?? null;
  }

  async currentPrice(providerSymbol: string, now = new Date()): Promise<PriceObservation | null> {
    const result = await this.fetchChart(providerSymbol, "range=5d&interval=1d");
    if (!result) return null;
    const { regularMarketPrice, regularMarketTime, currency } = result.meta;
    if (typeof regularMarketPrice !== "number" || typeof regularMarketTime !== "number") return null;
    return toObservation(regularMarketPrice, currency, regularMarketTime, "LAST", "TRADE", now);
  }

  async historicalPrice(providerSymbol: string, at: Date, now = new Date()): Promise<PriceObservation | null> {
    const atSeconds = Math.floor(at.getTime() / 1000);
    if (!Number.isFinite(atSeconds)) return null;
    // A window ending just after `at` (not "last 5 days") so older dates can be answered; the bar is
    // still chosen strictly at or before `at`.
    const result = await this.fetchChart(providerSymbol, "period1=" + (atSeconds - 10 * DAY_SECONDS) + "&period2=" + (atSeconds + DAY_SECONDS) + "&interval=1d");
    if (!result) return null;
    const timestamps = result.timestamp ?? [];
    const closes = result.indicators?.quote?.[0]?.close ?? [];
    let best: { ts: number; close: number } | null = null;
    for (let i = 0; i < Math.min(timestamps.length, closes.length); i += 1) {
      const ts = timestamps[i];
      const close = closes[i];
      if (close == null || !Number.isFinite(close) || ts * 1000 > at.getTime()) continue;
      if (!best || ts > best.ts) best = { ts, close };
    }
    if (!best) return null;
    return toObservation(best.close, result.meta.currency, best.ts, "CLOSE", "DAILY_BAR", now);
  }
}
