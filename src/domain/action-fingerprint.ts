export type ActionFingerprintInput={
  strategyInstanceId:string;
  strategyVersionId:string;
  lastReviewIso:string;
  actionType:string;
  currency:string;
  economicExposure:string;
  leverage:string;
  tradingLineId:string;
  executionAccountId:string;
  effectiveCash:string;
  contributionsSinceReview:string;
  stableHoldings:string;
  dataStatus:string;
  materialRevision?:string;
  /** Number of ledger rows. Append-only, so it changes whenever anything (including a correction) is recorded. */
  ledgerRevision?:string;
};

export function actionFingerprintMaterial(input:ActionFingerprintInput){
  return [
    input.strategyInstanceId,
    input.strategyVersionId,
    input.lastReviewIso,
    input.actionType,
    input.currency,
    input.economicExposure,
    input.leverage,
    input.tradingLineId,
    input.executionAccountId,
    input.effectiveCash,
    input.contributionsSinceReview,
    input.stableHoldings,
    input.dataStatus,
    input.materialRevision??"",
    input.ledgerRevision??""
  ].join("|");
}
