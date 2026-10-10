import {
  pgTable, uuid, text, timestamp, boolean, integer, bigint, numeric, jsonb,
  uniqueIndex, index, date, primaryKey
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
};

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  country: text("country").notNull().default("GB"),
  baseCurrency: text("base_currency").notNull().default("GBP"),
  timezone: text("timezone").notNull().default("Europe/London"),
  role: text("role").notNull().default("USER"),
  anonymousAggregateOptIn: boolean("anonymous_aggregate_opt_in").notNull().default(false),
  mfaSecretEncrypted: text("mfa_secret_encrypted"),
  mfaEnabledAt: timestamp("mfa_enabled_at",{withTimezone:true}),
  mfaLastStep: bigint("mfa_last_step",{mode:"number"}).notNull().default(-1),
  mfaRecoveryHashes: text("mfa_recovery_hashes").array().notNull().default(sql`'{}'::text[]`),
  sessionVersion: integer("session_version").notNull().default(0),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  ...timestamps
});

export const authTokens = pgTable("auth_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (t) => [index("auth_tokens_user_idx").on(t.userId, t.type)]);

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const plans = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  displayName: text("display_name").notNull(),
  description: text("description").notNull().default(""),
  monthlyPriceMinor: integer("monthly_price_minor").notNull().default(0),
  annualPriceMinor: integer("annual_price_minor").notNull().default(0),
  annualDiscountBps: integer("annual_discount_bps").notNull().default(0),
  billingCurrency: text("billing_currency").notNull().default("GBP"),
  supportedBillingCurrencies: jsonb("supported_billing_currencies").notNull().default(["GBP"]),
  stripeMonthlyPriceId: text("stripe_monthly_price_id"),
  stripeAnnualPriceId: text("stripe_annual_price_id"),
  maxActiveStrategies: integer("max_active_strategies"),
  entitlements: jsonb("entitlements").notNull().default({}),
  availableStrategyKeys: jsonb("available_strategy_keys").notNull().default([]),
  trialDays: integer("trial_days").notNull().default(0),
  visible: boolean("visible").notNull().default(true),
  archived: boolean("archived").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps
});

export const planPrices = pgTable("plan_prices", {
  id: uuid("id").primaryKey().defaultRandom(),
  planId: uuid("plan_id").notNull().references(() => plans.id, { onDelete: "cascade" }),
  currency: text("currency").notNull(),
  cadence: text("cadence").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  stripePriceId: text("stripe_price_id"),
  active: boolean("active").notNull().default(true),
  ...timestamps
}, (t) => [
  uniqueIndex("plan_price_unique").on(t.planId, t.currency, t.cadence),
  uniqueIndex("plan_price_stripe_unique").on(t.stripePriceId)
]);

export const billingWebhookEvents = pgTable("billing_webhook_events", {
  eventId: text("event_id").primaryKey(),
  eventType: text("event_type").notNull(),
  status: text("status").notNull().default("PROCESSING"),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  lastErrorCode: text("last_error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }).unique(),
  planId: uuid("plan_id").notNull().references(() => plans.id),
  status: text("status").notNull().default("FREE"),
  cadence: text("cadence").notNull().default("FREE"),
  stripeCustomerId: text("stripe_customer_id").unique(),
  stripeSubscriptionId: text("stripe_subscription_id").unique(),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  billingCheckedAt: timestamp("billing_checked_at", { withTimezone: true }),
  billingCheckError: text("billing_check_error"),
  ...timestamps
});

export const strategyDefinitions = pgTable("strategy_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  family: text("family").notNull(),
  description: text("description").notNull().default(""),
  engine: text("engine").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  proprietary: boolean("proprietary").notNull().default(false),
  defaultBenchmarkKey: text("default_benchmark_key"),
  supportedRegions: jsonb("supported_regions").notNull().default([]),
  supportedWrappers: jsonb("supported_wrappers").notNull().default([]),
  requiredInputs: jsonb("required_inputs").notNull().default([]),
  ...timestamps
});

export const strategyVersions = pgTable("strategy_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  strategyDefinitionId: uuid("strategy_definition_id").notNull().references(() => strategyDefinitions.id),
  version: text("version").notNull(),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  engineKey: text("engine_key").notNull(),
  lifecycleStatus: text("lifecycle_status").notNull().default("DRAFT"),
  upgradePolicy: text("upgrade_policy").notNull().default("OPTIONAL"),
  inputSchema: jsonb("input_schema").notNull().default([]),
  config: jsonb("config").notNull(),
  disclosure: text("disclosure").notNull().default(""),
  releaseNotes: text("release_notes").notNull().default(""),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  uniqueIndex("strategy_version_unique").on(t.strategyDefinitionId, t.version),
  index("strategy_version_effective_idx").on(t.strategyDefinitionId, t.effectiveFrom)
]);

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  wrapper: text("wrapper").notNull(),
  country: text("country").notNull(),
  currency: text("currency").notNull(),
  brokerName: text("broker_name"),
  ...timestamps
}, (t) => [index("accounts_user_idx").on(t.userId)]);

export const strategyInstances = pgTable("strategy_instances", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
  strategyDefinitionId: uuid("strategy_definition_id").notNull().references(() => strategyDefinitions.id),
  strategyVersionId: uuid("strategy_version_id").notNull().references(() => strategyVersions.id),
  name: text("name").notNull(),
  status: text("status").notNull().default("ACTIVE"),
  onboardingMode: text("onboarding_mode").notNull().default("START_NEW"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  healthStatus: text("health_status").notNull().default("NEEDS_ATTENTION"),
  lastReconciledAt: timestamp("last_reconciled_at", { withTimezone: true }),
  settings: jsonb("settings").notNull().default({}),
  executionConstraints: jsonb("execution_constraints").notNull().default({fractionalShares:true,minimumTradeAmount:"0",cashBufferAmount:"0",flatFee:"0",allowSelling:true}),
  contributionPlan: jsonb("contribution_plan").notNull().default({enabled:false,amount:"0",frequency:"MONTHLY",nextDate:null}),
  ...timestamps
}, (t) => [
  index("strategy_instances_user_idx").on(t.userId, t.status),
  index("strategy_instances_definition_idx").on(t.strategyDefinitionId, t.status)
]);

export const strategyAccounts = pgTable("strategy_accounts", {
  strategyInstanceId: uuid("strategy_instance_id").notNull().references(() => strategyInstances.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("SECONDARY"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  primaryKey({ columns: [t.strategyInstanceId, t.accountId] }),
  uniqueIndex("strategy_accounts_primary_unique").on(t.strategyInstanceId).where(sql`${t.role} = 'PRIMARY'`),
  index("strategy_accounts_account_idx").on(t.accountId)
]);

export const strategyVersionMigrations = pgTable("strategy_version_migrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  strategyInstanceId: uuid("strategy_instance_id").notNull().references(() => strategyInstances.id, { onDelete: "cascade" }),
  fromVersionId: uuid("from_version_id").notNull().references(() => strategyVersions.id),
  toVersionId: uuid("to_version_id").notNull().references(() => strategyVersions.id),
  stateBefore: jsonb("state_before").notNull().default({}),
  stateAfter: jsonb("state_after").notNull().default({}),
  migratedBy: text("migrated_by").notNull(),
  migratedAt: timestamp("migrated_at", { withTimezone: true }).notNull().defaultNow()
}, (t) => [index("strategy_version_migration_instance_idx").on(t.strategyInstanceId, t.migratedAt)]);

export const strategyCreationRequests = pgTable("strategy_creation_requests", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  requestKey: uuid("request_key").notNull(),
  requestPayload: jsonb("request_payload").notNull(),
  strategyInstanceId: uuid("strategy_instance_id").notNull().references(() => strategyInstances.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (t) => [primaryKey({ columns: [t.userId, t.requestKey] })]);

export const strategyStates = pgTable("strategy_states", {
  strategyInstanceId: uuid("strategy_instance_id").primaryKey().references(() => strategyInstances.id, { onDelete: "cascade" }),
  strategyVersionId: uuid("strategy_version_id").notNull().references(() => strategyVersions.id),
  state: jsonb("state").notNull().default({}),
  calculatedAt: timestamp("calculated_at", { withTimezone: true }).notNull().defaultNow(),
  sourceAsOf: timestamp("source_as_of", { withTimezone: true }),
  confidence: text("confidence").notNull().default("LOW")
});

export const instruments = pgTable("instruments", {
  id: uuid("id").primaryKey().defaultRandom(),
  isin: text("isin"),
  providerInstrumentId: text("provider_instrument_id"),
  name: text("name").notNull(),
  economicExposure: text("economic_exposure").notNull(),
  leverage: numeric("leverage", { precision: 12, scale: 6 }).notNull().default("1"),
  direction: text("direction").notNull().default("LONG"),
  fundCurrency: text("fund_currency"),
  ...timestamps
}, (t) => [
  uniqueIndex("instrument_isin_unique").on(t.isin),
  index("instrument_exposure_idx").on(t.economicExposure, t.leverage)
]);

export const tradingLines = pgTable("trading_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  instrumentId: uuid("instrument_id").notNull().references(() => instruments.id, { onDelete: "cascade" }),
  ticker: text("ticker").notNull(),
  exchange: text("exchange").notNull(),
  currency: text("currency").notNull(),
  exchangeTimezone: text("exchange_timezone").notNull(),
  providerSymbol: text("provider_symbol"),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  ...timestamps
}, (t) => [
  uniqueIndex("trading_line_unique").on(t.exchange, t.ticker, t.effectiveFrom),
  index("trading_line_instrument_idx").on(t.instrumentId)
]);

export const regionalInstrumentMappings = pgTable("regional_instrument_mappings", {
  id: uuid("id").primaryKey().defaultRandom(),
  economicExposure: text("economic_exposure").notNull(),
  leverage: numeric("leverage", { precision: 12, scale: 6 }).notNull().default("1"),
  direction: text("direction").notNull().default("LONG"),
  country: text("country").notNull(),
  wrapper: text("wrapper").notNull(),
  broker: text("broker"),
  preferredCurrency: text("preferred_currency"),
  tradingLineId: uuid("trading_line_id").notNull().references(() => tradingLines.id),
  fidelity: text("fidelity").notNull().default("EXACT"),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  enabled: boolean("enabled").notNull().default(true),
  ...timestamps
}, (t) => [
  index("regional_mapping_lookup_idx").on(t.economicExposure, t.country, t.wrapper, t.effectiveFrom)
]);

export const ledgerEvents = pgTable("ledger_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  strategyInstanceId: uuid("strategy_instance_id").notNull().references(() => strategyInstances.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  eventType: text("event_type").notNull(),
  currency: text("currency").notNull(),
  cashAmount: numeric("cash_amount", { precision: 24, scale: 8 }).notNull().default("0"),
  instrumentId: uuid("instrument_id").references(() => instruments.id),
  quantity: numeric("quantity", { precision: 30, scale: 12 }).notNull().default("0"),
  unitPrice: numeric("unit_price", { precision: 24, scale: 10 }),
  feeAmount: numeric("fee_amount", { precision: 24, scale: 8 }).notNull().default("0"),
  provenance: text("provenance").notNull().default("USER_ENTERED"),
  confidence: text("confidence").notNull().default("VERIFIED"),
  correctionOfEventId: uuid("correction_of_event_id"),
  metadata: jsonb("metadata").notNull().default({}),
  createdBy: text("created_by").notNull().default("USER"),
  requestKey: uuid("request_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`)
}, (t) => [
  index("ledger_instance_time_idx").on(t.strategyInstanceId, t.occurredAt, t.createdAt),
  uniqueIndex("ledger_events_strategy_request_unique").on(t.strategyInstanceId,t.requestKey).where(sql`${t.requestKey} IS NOT NULL`)
]);

export const reconciliations = pgTable("reconciliations", {
  id: uuid("id").primaryKey().defaultRandom(),
  strategyInstanceId: uuid("strategy_instance_id").notNull().references(() => strategyInstances.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  expectedValue: numeric("expected_value", { precision: 24, scale: 8 }),
  brokerReportedValue: numeric("broker_reported_value", { precision: 24, scale: 8 }),
  difference: numeric("difference", { precision: 24, scale: 8 }),
  reason: text("reason"),
  provenance: text("provenance").notNull().default("USER_CONFIRMED"),
  metadata: jsonb("metadata").notNull().default({}),
  requestKey: uuid("request_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  index("reconciliation_instance_idx").on(t.strategyInstanceId, t.occurredAt),
  uniqueIndex("reconciliations_strategy_request_unique").on(t.strategyInstanceId,t.requestKey).where(sql`${t.requestKey} IS NOT NULL`)
]);

export const overrides = pgTable("overrides", {
  id: uuid("id").primaryKey().defaultRandom(),
  strategyInstanceId: uuid("strategy_instance_id").notNull().references(() => strategyInstances.id, { onDelete: "cascade" }),
  fieldKey: text("field_key").notNull(),
  automaticValue: jsonb("automatic_value"),
  manualValue: jsonb("manual_value"),
  active: boolean("active").notNull().default(true),
  reason: text("reason"),
  observedAt: timestamp("observed_at", { withTimezone:true }),
  expiresAt: timestamp("expires_at", { withTimezone:true }),
  createdBy: text("created_by").notNull().default("USER"),
  restoredAt: timestamp("restored_at", { withTimezone: true }),
  ...timestamps
}, (t) => [index("override_active_idx").on(t.strategyInstanceId, t.fieldKey, t.active)]);

export const marketDataObservations = pgTable("market_data_observations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tradingLineId: uuid("trading_line_id").notNull().references(() => tradingLines.id, { onDelete: "cascade" }),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  price: numeric("price", { precision: 24, scale: 10 }).notNull(),
  currency: text("currency").notNull(),
  provider: text("provider").notNull(),
  freshness: text("freshness").notNull().default("CURRENT"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  uniqueIndex("market_observation_unique").on(t.tradingLineId, t.observedAt, t.provider),
  index("market_observation_latest_idx").on(t.tradingLineId, t.observedAt)
]);

export const actions = pgTable("actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  strategyInstanceId: uuid("strategy_instance_id").notNull().references(() => strategyInstances.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
  strategyVersionId: uuid("strategy_version_id").notNull().references(() => strategyVersions.id),
  fingerprint: text("fingerprint").notNull(),
  actionType: text("action_type").notNull(),
  status: text("status").notNull().default("CALCULATED"),
  title: text("title").notNull(),
  instruction: text("instruction").notNull(),
  amount: numeric("amount", { precision: 24, scale: 8 }),
  currency: text("currency"),
  tradingLineId: uuid("trading_line_id").references(() => tradingLines.id),
  explanation: jsonb("explanation").notNull().default({}),
  nextState: jsonb("next_state").notNull().default({}),
  confidence: text("confidence").notNull().default("HIGH"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  executedAt: timestamp("executed_at", { withTimezone: true }),
  reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  supersededByActionId: uuid("superseded_by_action_id"),
  calculatedAt: timestamp("calculated_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  uniqueIndex("action_fingerprint_unique").on(t.strategyInstanceId, t.fingerprint),
  index("action_queue_idx").on(t.strategyInstanceId, t.status, t.dueAt)
]);

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  actionId: uuid("action_id").references(() => actions.id, { onDelete: "cascade" }),
  reviewKey: text("review_key"),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  deliveriesCreatedAt: timestamp("deliveries_created_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (t) => [index("notification_user_idx").on(t.userId, t.readAt, t.createdAt), uniqueIndex("notification_action_unique").on(t.actionId), uniqueIndex("notification_review_key_unique").on(t.reviewKey).where(sql`${t.reviewKey} IS NOT NULL`)]);

export const notificationEndpoints = pgTable("notification_endpoints", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  channel: text("channel").notNull(),
  encryptedDestination: text("encrypted_destination").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  ...timestamps
}, (t) => [uniqueIndex("notification_endpoint_unique").on(t.userId, t.channel)]);

export const notificationDeliveries = pgTable("notification_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  notificationId: uuid("notification_id").notNull().references(() => notifications.id, { onDelete: "cascade" }),
  channel: text("channel").notNull(),
  dedupeKey: text("dedupe_key").notNull().unique(),
  status: text("status").notNull().default("PENDING"),
  attemptCount: integer("attempt_count").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  lastErrorCode: text("last_error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (t) => [index("notification_delivery_pending_idx").on(t.status, t.nextAttemptAt)]);

export const performanceSeries = pgTable("performance_series", {
  strategyInstanceId: uuid("strategy_instance_id").notNull().references(() => strategyInstances.id, { onDelete: "cascade" }),
  seriesType: text("series_type").notNull(),
  date: date("date").notNull(),
  value: numeric("value", { precision: 28, scale: 10 }).notNull(),
  metadata: jsonb("metadata").notNull().default({})
}, (t) => [primaryKey({ columns: [t.strategyInstanceId, t.seriesType, t.date] })]);

export const benchmarks = pgTable("benchmarks", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  economicExposure: text("economic_exposure").notNull(),
  description: text("description").notNull().default("")
});

export const benchmarkPerformance = pgTable("benchmark_performance", {
  benchmarkId: uuid("benchmark_id").notNull().references(() => benchmarks.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  value: numeric("value", { precision: 28, scale: 10 }).notNull(),
  source: text("source").notNull().default("ADMIN"),
  metadata: jsonb("metadata").notNull().default({})
}, (t) => [primaryKey({ columns: [t.benchmarkId, t.date] })]);

export const strategyVersionBenchmarks = pgTable("strategy_version_benchmarks", {
  strategyVersionId: uuid("strategy_version_id").notNull().references(() => strategyVersions.id, { onDelete: "cascade" }),
  benchmarkId: uuid("benchmark_id").notNull().references(() => benchmarks.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  defaultVisible: boolean("default_visible").notNull().default(false)
}, (t) => [
  primaryKey({ columns: [t.strategyVersionId, t.benchmarkId] }),
  index("strategy_version_benchmark_order_idx").on(t.strategyVersionId, t.sortOrder)
]);

export const canonicalModelPerformance = pgTable("canonical_model_performance", {
  strategyVersionId: uuid("strategy_version_id").notNull().references(() => strategyVersions.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  value: numeric("value", { precision: 28, scale: 10 }).notNull(),
  benchmarkValue: numeric("benchmark_value", { precision: 28, scale: 10 }),
  source: text("source").notNull().default("ADMIN"),
  metadata: jsonb("metadata").notNull().default({})
}, (t) => [primaryKey({ columns: [t.strategyVersionId, t.date] })]);

export const workerRuns = pgTable("worker_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workerKey: text("worker_key").notNull(),
  status: text("status").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  details: jsonb("details").notNull().default({})
}, (t) => [index("worker_runs_key_time_idx").on(t.workerKey, t.startedAt)]);

export const anonymousAggregates = pgTable("anonymous_aggregates", {
  id: uuid("id").primaryKey().defaultRandom(),
  strategyDefinitionId: uuid("strategy_definition_id").notNull().references(() => strategyDefinitions.id),
  cohortKey: text("cohort_key").notNull(),
  metricKey: text("metric_key").notNull(),
  asOfDate: date("as_of_date").notNull(),
  sampleSize: integer("sample_size").notNull(),
  value: numeric("value", { precision: 28, scale: 10 }).notNull(),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  uniqueIndex("anonymous_aggregate_unique").on(t.strategyDefinitionId, t.cohortKey, t.metricKey, t.asOfDate),
  index("anonymous_aggregate_publish_idx").on(t.asOfDate, t.sampleSize)
]);

export const featureFlags = pgTable("feature_flags", {
  key: text("key").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  config: jsonb("config").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  metadata: jsonb("metadata").notNull().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow()
}, (t) => [index("audit_events_time_idx").on(t.occurredAt)]);
