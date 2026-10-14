/** Read-only interpretation of stored subscription data for operators.
 * This does not infer that a charge succeeded or that a customer should lose access.
 */
export type SubscriptionWatchRecord = {
  status: string;
  cancelAtPeriodEnd: boolean;
  periodEnd: Date | null;
  hasBillingCheckError: boolean;
};
export type SubscriptionWatchReason =
  | "Billing check flagged"
  | "Payment status needs review"
  | "Recorded period has ended"
  | "Scheduled to end"
  | null;

export function subscriptionWatchReason(record: SubscriptionWatchRecord, now: Date): SubscriptionWatchReason {
  if (record.hasBillingCheckError) return "Billing check flagged";
  if (record.status === "PAST_DUE" || record.status === "UNPAID") return "Payment status needs review";
  if (record.status !== "ACTIVE" && record.status !== "TRIALING") return null;
  if (record.periodEnd && record.periodEnd.getTime() < now.getTime()) return "Recorded period has ended";
  if (record.cancelAtPeriodEnd) return "Scheduled to end";
  return null;
}
