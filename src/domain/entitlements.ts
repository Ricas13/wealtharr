/** Every plan feature an administrator can grant. Single source for the plan editor, the plan API and the admin snapshot. */
export const ALL_FEATURES = ["history","reconciliation","resume","community","analytics","comparisons","what_if","advanced_imports","multi_account"] as const;
/** Every notification channel a plan can grant (IN_APP is always included for everyone). */
export const ALL_CHANNELS = ["EMAIL","DISCORD","TELEGRAM"] as const;
export type FeatureKey = (typeof ALL_FEATURES)[number];
export type ChannelKey = (typeof ALL_CHANNELS)[number];

export type PlanRecord = {
  slug: string;
  maxActiveStrategies: number | null;
  entitlements: unknown;
  availableStrategyKeys: unknown;
};

export type EntitlementSnapshot = {
  planSlug: string;
  maxActiveStrategies: number | null;
  features: Set<string>;
  notificationChannels: Set<string>;
  availableStrategyKeys: Set<string> | null;
};

function parseJsonish(value:unknown){
  if(typeof value!=="string")return value;
  try{return JSON.parse(value);}catch{return value;}
}

function strings(value: unknown) {
  const parsed=parseJsonish(value);
  return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
}

export function buildEntitlementSnapshot(plan: PlanRecord): EntitlementSnapshot {
  const parsedEntitlements=parseJsonish(plan.entitlements);
  const raw = (parsedEntitlements && typeof parsedEntitlements === "object" && !Array.isArray(parsedEntitlements) ? parsedEntitlements : {}) as Record<string, unknown>;
  const strategyKeys = strings(plan.availableStrategyKeys);
  return {
    planSlug: plan.slug,
    maxActiveStrategies: plan.maxActiveStrategies,
    features: new Set(strings(raw.features)),
    notificationChannels: new Set(["IN_APP", ...strings(raw.notificationChannels)]),
    availableStrategyKeys: strategyKeys.length ? new Set(strategyKeys) : null
  };
}

/**
 * Entitlements for an administrator: an entitlement bypass only. No strategy limit, every feature,
 * every channel and no strategy-key restriction. Admin-only powers stay behind requireAdmin and MFA.
 */
export function adminEntitlementSnapshot(): EntitlementSnapshot {
  return {
    planSlug: "admin",
    maxActiveStrategies: null,
    features: new Set<string>(ALL_FEATURES),
    notificationChannels: new Set<string>(["IN_APP", ...ALL_CHANNELS]),
    availableStrategyKeys: null
  };
}

export function assertCanCreateStrategy(snapshot: EntitlementSnapshot, activeCount: number, strategyKey: string) {
  if (snapshot.maxActiveStrategies !== null && activeCount >= snapshot.maxActiveStrategies) throw new Error("PLAN_STRATEGY_LIMIT");
  if (snapshot.availableStrategyKeys && !snapshot.availableStrategyKeys.has(strategyKey)) throw new Error("STRATEGY_NOT_IN_PLAN");
}


export function assertStrategyFeatureAccess(snapshot:EntitlementSnapshot,input:{accountCount:number}){
  if(input.accountCount>1&&!snapshot.features.has("multi_account"))throw new Error("MULTI_ACCOUNT_NOT_IN_PLAN");
}
