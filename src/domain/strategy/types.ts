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

export type HistoricalPricePoint = { at: Date; adjustedClose: Decimal; monthTerminalCertified?: boolean }; 
export type TrustedHistoricalSeries = { exposure: string; currency: string; points: HistoricalPricePoint[]; source: string; calendarCertified?: boolean; totalReturnCertified?: boolean }; 

export type EngineContext = {
  strategyInstanceId: string;
  strategyVersionId: string;
  now: Date;
  baseCurrency: string;
  cash: Decimal;
  exposures: ExposurePosition[];
  contributionsSinceReview: Decimal;
  /** Withdrawals since the last completed review (positive amount); read only by engines that use it. */
  withdrawalsSinceReview?: Decimal;
  /** User-selected estimated flat fee per executed trade, in the account currency.
   * Only used for practical multi-leg funding: NEVER a substitute for the actual broker fee in the ledger.
   */
  executionFlatFee?: Decimal;
  state: Record<string, unknown>;
  config: Record<string, unknown>;
  settings: Record<string, unknown>;
  reviewDue: boolean;
  nextReviewAt?: Date | null;
  dataHealth: DataHealth;
  /** Must be populated by an authenticated licensed market-data adapter, never user settings. */
  trustedHistory?: TrustedHistoricalSeries[];
  /** Gross confirmed review fills derived from the ledger, never proposals. */
  confirmedQuarterTrades?: {buyGross: Decimal;sellGross: Decimal;feeTotal: Decimal;reserveBeforeTrades: Decimal;};
  /** Confirmed executed fills of the current review split by managed sleeve (quarterly signal family). */
  sigReviewTrades?: {stockBuyGross: Decimal;stockSellGross: Decimal;safeBuyGross: Decimal;safeSellGross: Decimal;feeTotal: Decimal;};
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
  /**
   * State that closes the review if this trade turns out to be smaller than the smallest practical order
   * (below one share or the minimum trade). Without it the remainder would fail closed forever.
   */
  residueCloseState?: Record<string, unknown>;
  /** A housekeeping order (sweeping idle cash into the safe sleeve) that may also close the review when unaffordable. */
  optionalSweep?: boolean;
};

export interface StrategyEngine {
  key: string;
  validateConfig(config: Record<string, unknown>): void;
  calculate(ctx: EngineContext): ProposedAction;
}
