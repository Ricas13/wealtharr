import "server-only";
import Decimal from "decimal.js";
import { z } from "zod";

export type PriceObservation = {
  price: string;
  currency: string;
  observedAt: Date;
  provider: string;
  granularity?: "TRADE"|"MINUTE_BAR"|"DAILY_BAR";
  priceKind?: "LAST"|"OPEN"|"HIGH"|"LOW"|"CLOSE";
  /** Explicit provider assertion: split/distribution-adjusted bar, not merely a daily close. */
  corporateActionsAdjusted?: boolean;
};

export interface MarketDataProvider {
  name: string;
  configured: boolean;
  currentPrice(providerSymbol: string): Promise<PriceObservation | null>;
  historicalPrice(providerSymbol: string, at: Date): Promise<PriceObservation | null>;
}

// `new URL("/quote", "https://host/v1")` resolves to https://host/quote and silently drops the
// provider's path prefix, which turned every lookup into a 404 ("no quote"). Append instead.
export function buildQuoteUrl(baseUrl: string, path: string, params: Record<string, string>) {
  const url = new URL(baseUrl);
  url.pathname = url.pathname.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, "");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

const quoteSchema = z.object({
  price: z.union([z.string(), z.number()]),
  currency: z.string().length(3),
  observedAt: z.string().datetime({ offset: true }),
  granularity: z.enum(["TRADE","MINUTE_BAR","DAILY_BAR"]).optional(),
  priceKind: z.enum(["LAST","OPEN","HIGH","LOW","CLOSE"]).optional(),
  corporateActionsAdjusted: z.boolean().optional()
});

function validatedObservation(raw: unknown, provider: string): PriceObservation {
  const parsed = quoteSchema.parse(raw);
  const price = new Decimal(String(parsed.price));
  if (!price.isFinite() || price.lte(0)) throw new Error("MARKET_DATA_INVALID_PRICE");
  return {
    price: price.toString(),
    currency: parsed.currency.toUpperCase(),
    observedAt: new Date(parsed.observedAt),
    provider,
    granularity: parsed.granularity,
    priceKind: parsed.priceKind,
    corporateActionsAdjusted: parsed.corporateActionsAdjusted
  };
}

class UnconfiguredMarketDataProvider implements MarketDataProvider {
  name = "unconfigured";
  configured = false;
  async currentPrice() { return null; }
  async historicalPrice() { return null; }
}

export class MockMarketDataProvider implements MarketDataProvider {
  name = "mock";
  configured = true;
  constructor(private prices: Record<string, string> = {}) {}
  async currentPrice(providerSymbol: string) {
    const price = this.prices[providerSymbol];
    return price ? { price, currency: "GBP", observedAt: new Date(), provider: this.name } : null;
  }
  async historicalPrice(providerSymbol: string, at: Date) {
    const price = this.prices[providerSymbol];
    return price ? { price, currency: "GBP", observedAt: at, provider: this.name } : null;
  }
}

class HttpMarketDataProvider implements MarketDataProvider {
  name = "http";
  configured: boolean;

  constructor(private baseUrl: string | undefined, private token: string | undefined) {
    this.configured = Boolean(baseUrl && token);
  }

  private async fetchQuote(path: string, params: Record<string, string>) {
    if (!this.configured || !this.baseUrl || !this.token) return null;
    const url = buildQuoteUrl(this.baseUrl, path, params);
    if (url.protocol !== "https:" && process.env.NODE_ENV === "production") {
      throw new Error("MARKET_DATA_HTTPS_REQUIRED");
    }

    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        authorization: "Bearer " + this.token
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000)
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("MARKET_DATA_HTTP_" + response.status);
    return validatedObservation(await response.json(), this.name);
  }

  async currentPrice(providerSymbol: string) {
    return this.fetchQuote("/quote", { symbol: providerSymbol });
  }

  async historicalPrice(providerSymbol: string, at: Date) {
    return this.fetchQuote("/historical", { symbol: providerSymbol, at: at.toISOString() });
  }
}

export function getMarketDataProvider(): MarketDataProvider {
  if (process.env.NODE_ENV !== "production" && process.env.MARKET_DATA_PROVIDER === "mock") {
    return new MockMarketDataProvider();
  }
  if (process.env.MARKET_DATA_PROVIDER === "http") {
    return new HttpMarketDataProvider(process.env.MARKET_DATA_HTTP_BASE_URL, process.env.MARKET_DATA_HTTP_TOKEN);
  }
  return new UnconfiguredMarketDataProvider();
}

export { classifyFreshness } from "@/domain/market-freshness";
