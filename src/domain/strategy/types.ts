import type Decimal from "decimal.js";

export type DataHealth = {
  status: "CURRENT" | "STALE" | "MISSING";
  message?: string;
  sourceAsOf?: Date | null;
};

export type ExposurePosition = {
  economicExposure: string;
  value: Decimal;
  tradingLineId?: string;
};

export type HistoricalPricePoint = { at: Date; adjustedClose: Decimal }; 
export type TrustedHistoricalSeries = { exposure: string; currency: string; points: HistoricalPricePoint[]; source: string }; 

export type EngineContext = {
  strategyInstanceId: string;
  strategyVersionId: string;
  now: Date;
  baseCurrency: string;
  cash: Decimal;
  exposures: ExposurePosition[];
  contributionsSinceReview: Decimal;
  state: Record<string, unknown>;
  config: Record<string, unknown>;
  settings: Record<string, unknown>;
  reviewDue: boolean;
  nextReviewAt?: Date | null;
  dataHealth: DataHealth;
  /** Must be populated by an authenticated licensed market-data adapter, never user settings. */
  trustedHistory?: TrustedHistoricalSeries[];
  /** Ledger-derived confirmed gross fills for the current review. Never include unfilled proposals. */
  confirmedQuarterTrades?: {
    buyGross: Decimal;
    sellGross: Decimal;
    feeTotal: Decimal;
    reserveBeforeTrades: Decimal;
  };
};

export type ExplanationRow = {
  label: string;
  value: string;
  kind?: "money" | "percent" | "text";
};

export type ProposedAction = {
  actionType: "BUY" | "SELL" | "REBALANCE" | "HOLD" | "NO_ACTION" | "DATA_REQUIRED";
  title: string;
  instruction: string;
  amount?: Decimal;
  currency?: string;
  economicExposure?: string;
  leverage?: string;
  explanation: ExplanationRow[];
  nextState: Record<string, unknown>;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  dueAt?: Date | null;
  completesReview?: boolean;
  /** Machine code of a DATA_REQUIRED outcome from the execution convention (alert text and notification key). */
  reasonCode?: string;
};

export interface StrategyEngine {
  key: string;
  validateConfig(config: Record<string, unknown>): void;
  calculate(ctx: EngineContext): ProposedAction;
}
