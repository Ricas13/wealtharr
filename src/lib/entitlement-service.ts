import { EXECUTABLE_ACTION_STATUS_SQL } from "@/domain/actions";
import "server-only";
import type { Sql } from "postgres";
import { sql } from "@/lib/db";
import { adminEntitlementSnapshot, assertCanCreateStrategy, assertStrategyFeatureAccess, buildEntitlementSnapshot, type EntitlementSnapshot } from "@/domain/entitlements";

// Anything that can run `unsafe`: the shared client or an open transaction handle.
export type EntitlementDb = Pick<Sql, "unsafe">;

/**
 * Resolves a user's entitlements on `db`. A live (not soft-deleted) ADMIN is an entitlement
 * super-user; everyone else gets their plan. `lockSubscription` keeps the subscription row lock
 * that downgrade-race protection relies on (non-admins only: admins have no limit to race).
 */
export async function loadEntitlementsWith(db: EntitlementDb, userId: string, options: { lockSubscription?: boolean } = {}) {
  const roles = await db.unsafe("SELECT role FROM users WHERE id=$1 AND deleted_at IS NULL LIMIT 1", [userId]);
  if (roles[0] && String(roles[0].role) === "ADMIN") return adminEntitlementSnapshot();
  let rows = await db.unsafe(
    "SELECT p.slug,p.max_active_strategies,p.entitlements,p.available_strategy_keys FROM subscriptions s JOIN plans p ON p.id=s.plan_id "+
    "WHERE s.user_id=$1 AND s.status IN ('FREE','ACTIVE','TRIALING','PAST_DUE') "+
    "ORDER BY CASE s.status WHEN 'ACTIVE' THEN 0 WHEN 'TRIALING' THEN 1 WHEN 'PAST_DUE' THEN 2 ELSE 3 END "+
    "LIMIT 1"+(options.lockSubscription ? " FOR UPDATE OF s" : ""),
    [userId]
  );
  // A time-limited complimentary beta grant changes only feature entitlements:
  // it never creates/updates a Stripe subscription or asserts a successful payment.
  // An actual paid subscription always takes precedence.
  if (!rows[0] || String(rows[0].slug)==="free") {
    const grants = await db.unsafe(
      "SELECT p.slug,p.max_active_strategies,p.entitlements,p.available_strategy_keys " +
      "FROM private_beta_grants g JOIN plans p ON p.id=g.plan_id " +
      "WHERE g.user_id=$1 AND g.revoked_at IS NULL AND g.expires_at>now() " +
      "AND p.archived=false AND p.slug<>'free' LIMIT 1",
      [userId]
    );
    if (grants[0]) rows=grants;
  }
  if (!rows[0]) rows = await db.unsafe("SELECT slug,max_active_strategies,entitlements,available_strategy_keys FROM plans WHERE slug='free' LIMIT 1");
  if (!rows[0]) throw new Error("FREE_PLAN_MISSING");
  return buildEntitlementSnapshot({
    slug: String(rows[0].slug),
    maxActiveStrategies: rows[0].max_active_strategies == null ? null : Number(rows[0].max_active_strategies),
    entitlements: rows[0].entitlements,
    availableStrategyKeys: rows[0].available_strategy_keys
  });
}

export async function loadEntitlements(userId: string) {
  return loadEntitlementsWith(sql, userId);
}

export async function assertStrategyCreationAllowed(userId: string, strategyKey: string) {
  const snapshot = await loadEntitlements(userId);
  const countRows = await sql.unsafe("SELECT count(*)::int AS count FROM strategy_instances WHERE user_id=$1 AND status='ACTIVE'", [userId]);
  assertCanCreateStrategy(snapshot, Number(countRows[0]?.count ?? 0), strategyKey);
  return snapshot;
}

export async function assertNotificationAllowed(userId: string, channel: string) {
  const snapshot = await loadEntitlements(userId);
  if (!snapshot.notificationChannels.has(channel)) throw new Error("CHANNEL_NOT_IN_PLAN");
}

export async function enforceStrategyEntitlements(userId: string, snapshot?: EntitlementSnapshot) {
  const entitlements = snapshot ?? await loadEntitlements(userId);
  const active = await sql.unsafe(
    "SELECT i.id,d.key,d.enabled AS definition_enabled,i.admin_disabled_preview,ua.allowed AS user_strategy_allowed,(SELECT count(*)::int FROM strategy_accounts sa WHERE sa.strategy_instance_id=i.id) AS account_count "+
    "FROM strategy_instances i JOIN strategy_definitions d ON d.id=i.strategy_definition_id "+
    "LEFT JOIN user_strategy_access ua ON ua.user_id=i.user_id AND ua.strategy_definition_id=i.strategy_definition_id "+
    "WHERE i.user_id=$1 AND i.status='ACTIVE' ORDER BY i.started_at ASC,i.created_at ASC",
    [userId]
  );

  const unavailableFeature = active.filter((row) => {
    try{
      assertStrategyFeatureAccess(entitlements,{accountCount:Number(row.account_count??1)});
      return false;
    }catch{
      return true;
    }
  });
  const unavailableFeatureIds=new Set(unavailableFeature.map((row)=>String(row.id)));
  // Only instances started through the admin preview of a (still) disabled definition are affected, and
  // only for an owner who no longer has the super-user flag. A customer who legitimately runs a strategy
  // that was disabled later is not marked and keeps running.
  const previewBlocked = (row: Record<string, unknown>) =>
    !entitlements.includeDisabledStrategies && row.admin_disabled_preview === true && row.definition_enabled !== true;
  const permitted = active.filter((row) =>
    !unavailableFeatureIds.has(String(row.id))&&!previewBlocked(row)&&row.user_strategy_allowed!==false&&
    (!entitlements.availableStrategyKeys || entitlements.availableStrategyKeys.has(String(row.key)))
  );
  const disallowed = active.filter((row) =>
    unavailableFeatureIds.has(String(row.id))||previewBlocked(row)||row.user_strategy_allowed===false||
    Boolean(entitlements.availableStrategyKeys&&!entitlements.availableStrategyKeys.has(String(row.key)))
  );
  const max = entitlements.maxActiveStrategies;
  const overLimit = max == null ? [] : permitted.slice(max);
  const toPause = [...disallowed, ...overLimit];
  if (!toPause.length) return { paused: 0 };

  const ids = toPause.map((row) => String(row.id));
  await sql.begin(async (tx) => {
    await tx.unsafe("UPDATE strategy_instances SET status='PAUSED',paused_at=now(),updated_at=now() WHERE user_id=$1 AND id=ANY($2::uuid[]) AND status='ACTIVE'",[userId,ids]);
    await tx.unsafe(
      "UPDATE actions SET status='CANCELLED',cancelled_at=now(),updated_at=now() WHERE strategy_instance_id=ANY($1::uuid[]) AND status IN ("+EXECUTABLE_ACTION_STATUS_SQL+")",
      [ids]
    );
    await tx.unsafe(
      "INSERT INTO audit_events (actor_user_id,action,entity_type,metadata) VALUES ($1,'entitlements.enforced','subscription',$2::jsonb)",
      [userId,JSON.stringify({plan:entitlements.planSlug,pausedStrategyInstanceIds:ids,featurePausedStrategyInstanceIds:[...unavailableFeatureIds].filter((id)=>ids.includes(id)),adminPreviewPausedStrategyInstanceIds:toPause.filter(previewBlocked).map((row)=>String(row.id))})]
    );
  });
  return { paused: ids.length };
}
