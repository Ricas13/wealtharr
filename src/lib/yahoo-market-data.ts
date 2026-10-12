import "server-only";
import Decimal from "decimal.js";
import { z } from "zod";
import type { MarketDataProvider, PriceObservation, RejectedQuote } from "@/lib/market-data";
import { FUTURE_SKEW_MS } from "@/domain/market-freshness";

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
const FUTURE_TOLERANCE_MS = FUTURE_SKEW_MS;
const DAY_SECONDS = 86_400;

// Letters, digits and the few punctuation characters real Yahoo symbols use (e.g. VWRL.L, ^FTSE, GBPUSD=X).
// At least one letter or digit, so "." and "=" alone are never sent.
const SYMBOL_PATTERN = /^(?=.*[A-Za-z0-9])[A-Za-z0-9.^=-]{1,24}$/;
const MAX_BODY_CHARS = 1_000_000;
// A first quote has no history to compare with, so it must sit within this band of the
// provider's own previous/closing prices in the same response (guards pence/pound x100 errors).
const REFERENCE_MIN_RATIO = new Decimal("0.5");
const REFERENCE_MAX_RATIO = new Decimal(2);

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
  if (value === "GBX") return { code: "GBP", hundredths: true };
  if (/^[A-Z]{3}$/.test(value)) {
    if (UNSUPPORTED_SUBUNITS.has(value)) return null;
    return { code: value, hundredths: false };
  }
  return null; // lowercase/mixed case ("ZAc", "gbp"), wrong length or non-letters: do not guess
}

const resultSchema = z.object({
  meta: z.object({
    regularMarketPrice: z.number().optional().nullable(),
    regularMarketTime: z.number().optional().nullable(),
    chartPreviousClose: z.number().optional().nullable(),
    previousClose: z.number().optional().nullable(),
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
    const text = await response.text();
    if (text.length > MAX_BODY_CHARS) throw new Error("MARKET_DATA_INVALID_RESPONSE");
    let json: unknown;
    try { json = JSON.parse(text); } catch { throw new Error("MARKET_DATA_INVALID_RESPONSE"); }
    const parsed = payloadSchema.safeParse(json);
    if (!parsed.success) throw new Error("MARKET_DATA_INVALID_RESPONSE");
    const chart = parsed.data.chart;
    if (chart.error) return null;
    const first = chart.result?.[0];
    return first ?? null;
  }

  async currentPrice(providerSymbol: string, now = new Date()): Promise<PriceObservation | null> {
    return (await this.currentPriceDetailed(providerSymbol, now)).observation;
  }

  /**
   * Same as currentPrice, but a quote that was well-formed and then refused as implausible against the
   * provider's own references (a stock split, pence/pound x100) is reported in `rejected` so the worker
   * can record it and keep actions failing closed instead of silently reusing an older price.
   */
  async currentPriceDetailed(providerSymbol: string, now = new Date()): Promise<{ observation: PriceObservation | null; rejected?: RejectedQuote }> {
    const result = await this.fetchChart(providerSymbol, "range=5d&interval=1d");
    if (!result) return { observation: null };
    const { regularMarketPrice, regularMarketTime, currency } = result.meta;
    if (typeof regularMarketPrice !== "number" || typeof regularMarketTime !== "number") return { observation: null };
    const observation = toObservation(regularMarketPrice, currency, regularMarketTime, "LAST", "TRADE", now);
    if (!observation) return { observation: null };

    // First-quote sanity check: compare with the provider's own previous/last closes, converted
    // with the same currency rule. No reference at all means it cannot be checked, so fail closed.
    const normalised = normaliseYahooCurrency(currency);
    if (!normalised) return { observation: null };
    const lastClose = [...(result.indicators?.quote?.[0]?.close ?? [])].reverse().find((c) => c != null && Number.isFinite(c));
    const references: number[] = [];
    for (const candidate of [result.meta.chartPreviousClose, result.meta.previousClose, lastClose]) {
      if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0) references.push(candidate);
    }
    if (references.length === 0) return { observation: null };
    const current = new Decimal(observation.price);
    for (const raw of references) {
      let reference = new Decimal(String(raw));
      if (normalised.hundredths) reference = reference.div(100);
      const ratio = current.div(reference);
      // Exclusive band: an exact 2:1 split (ratio 0.5) or doubling (ratio 2) is refused too.
      if (ratio.lte(REFERENCE_MIN_RATIO) || ratio.gte(REFERENCE_MAX_RATIO)) {
        return {
          observation: null,
          rejected: { code: "IMPLAUSIBLE_MOVE", price: observation.price, currency: observation.currency, observedAt: observation.observedAt, provider: YAHOO_PROVIDER_NAME }
        };
      }
    }
    return { observation };
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
      // A daily bar is stamped at its session open. Approximating "the day has completed" as
      // open + 24h <= at keeps an in-progress session's partial close (really the live price) out.
      if (close == null || !Number.isFinite(close) || ts + DAY_SECONDS > atSeconds) continue;
      if (!best || ts > best.ts) best = { ts, close };
    }
    if (!best) return null;
    return toObservation(best.close, result.meta.currency, best.ts, "CLOSE", "DAILY_BAR", now);
  }
}
