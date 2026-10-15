/**
 * Strategy plugin contract.
 *
 * One file per strategy lives beside this one (`<key>.ts`, exporting `plugin`) and is registered in
 * `./index.ts`. A plugin carries everything the portal knows about a strategy: the reference profile
 * (rules, sources, risks, engine and immutable config), what the installer seeds, and pointers to the
 * specification card and golden tests that back it. Rules live in code; strategies reference economic
 * exposures, never tickers. Published versions are immutable, so a rule change is a new version.
 */

/**
 * Research-backed reference profiles. These are NOT automatically published:
 * regulated instruments, regional wrappers and live quotes must be verified first.
 * Allocation exposures are abstract asset classes rather than ticker guarantees.
 */
export type StrategyProfile = {
  key: string;
  name: string;
  engine: "FIXED_ALLOCATION" | "VALUE_TARGET" | "MOMENTUM_ROTATION" | "TACTICAL_ALLOCATION" | "TWO_FUNDS_MODERATE" | "TRINITY_HYBRID" | "RESEARCH_PENDING";
  launchState: "DRAFT_REQUIRES_VERIFICATION";
  config?: Record<string, unknown>;
  /** Shown to the investor with the strategy; required whenever it holds a leveraged exposure. */
  disclosure?: string;
  /** Fields an investor fills in when starting the strategy (stored on the strategy version). */
  inputSchema?: Array<Record<string, unknown>>;
  rules: string;
  research: string[];
  risks: string[];
};

export type StrategyEngineKey = StrategyProfile["engine"];

export const fixed = (allocations: [string,string][], frequency:"MONTHLY"|"QUARTERLY"|"ANNUAL") => ({
  allocations: allocations.map(([exposure,weight])=>({exposure,weight})),
  reviewFrequency:frequency,
  rebalanceThreshold:"0.00"
});

export const LEVERAGE_DISCLOSURE =
  "This strategy holds leveraged products that reset their leverage every day. Because of that reset, returns over longer periods can differ sharply from the stated multiple of the index, and losses can compound in volatile or falling markets (volatility decay). They can fall a great deal in a short time and are unsuitable for many investors. Rules-based calculation only, not individual investment advice; past performance is not a guide to the future.";

/**
 * What `scripts/seed.ts` inserts for this strategy on a fresh install. The seed is insert-only:
 * it never updates an existing definition or version (the one guarded exception is the
 * research-only realignment for coffeehouse, core-four and swensen: see `realignsResearchOnlyDefinition`),
 * so editing these values does not change an installed database.
 */
export type SeedDefinition = {
  name: string;
  family: string;
  description: string;
  engine: StrategyEngineKey;
  proprietary: boolean;
  /** Initial `enabled` flag of the definition row. */
  enabled: boolean;
  supportedRegions: readonly string[];
  supportedWrappers: readonly string[];
  /**
   * Lifecycle of the version "1.0" row the seed inserts, or null when the seed inserts no version
   * (strategies whose engine is not yet customer-publishable).
   */
  initialVersion: "PUBLISHED" | "DRAFT" | null;
  /**
   * True when earlier installs held this key as a research-only definition without versions: the
   * seed then realigns name, description, family and engine, but only while the definition is
   * disabled and has no published version.
   */
  realignsResearchOnlyDefinition: boolean;
};

/** Rules of a code-released strategy that is not part of the research reference catalogue (9Sig). */
export type CodeRelease = {
  engine: "VALUE_TARGET";
  config: Readonly<Record<string, unknown>>;
  /** One-line description shown in the admin inventory when no profile exists. */
  summary: string;
};

export type StrategyPlugin = {
  /** Must equal the file name (without extension). */
  key: string;
  /**
   * The reference-catalogue profile, which becomes an entry of `RESEARCH_STRATEGIES`.
   * Null only for a strategy released directly from code (see `codeRelease`).
   */
  profile: StrategyProfile | null;
  /** Present exactly when `profile` is null. */
  codeRelease?: CodeRelease;
  /** Null when the seed only creates the generic research definition row. */
  seedDefinition: SeedDefinition | null;
  /** Repo-relative path of the specification card under docs/strategy-specs, or null. */
  specCard: string | null;
  /** Repo-relative path of the golden tests with independently computed values, or null. */
  goldenTests: string | null;
  /**
   * Explicit claim that the method is finished. Absent means INCOMPLETE. The claim is only honoured
   * when `isMethodComplete` (src/domain/strategy/method-complete.ts) also finds every checklist
   * item satisfied, so declaring COMPLETE alone never releases anything. It is not a human
   * attestation and does not imply market eligibility or enablement.
   */
  releaseStatus?: "COMPLETE" | "INCOMPLETE";
};
