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
  /**
   * Ledger totals for the 9Sig v1.1 signal method (`methodRevision`), populated by the action service
   * only for that revision; every other engine and revision ignores it. newCash: contributions and
   * distributions recorded (created_at) inside the quarter's window; newCashAfterCutoff: the same
   * rows recorded after the latest quarter-end cutoff. filledBuy/filledSell/filledBuyFees: gross
   * notional (and BUY fees) of BUY/SELL rows recorded since the open review started, or, with no
   * open review, since the due quarter's cutoff. staleFilledBuy/staleFilledSell: fills of an open
   * review that a newer quarter-end cutoff has expired (zero otherwise).
   */
  signalLedger?: {
    newCash: Decimal; newCashAfterCutoff: Decimal;
    filledBuy: Decimal; filledSell: Decimal; filledBuyFees: Decimal;
    staleFilledBuy: Decimal; staleFilledSell: Decimal;
  };
  /** When the strategy instance started; used by the 9Sig v1.1 method for upgraded 1.0 states. */
  strategyStartedAt?: Date;
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
  /**
   * Only set by the 9Sig v1.1 signal method on BUY/SELL: the review-closing HOLD to use instead of
   * DATA_REQUIRED when the user's execution constraints make the remaining order untradeable
   * (below one share, below the minimum trade, or no spendable cash).
   */
  unexecutableFallback?: ProposedAction;
};

export interface StrategyEngine {
  key: string;
  validateConfig(config: Record<string, unknown>): void;
  calculate(ctx: EngineContext): ProposedAction;
}
