import type { StrategyEngine } from "./types";
import { syntheticCatalogueFixtureAllowed } from "./ci-fixture";
import { valueTargetEngine } from "./value-target";
import { fixedAllocationEngine } from "./fixed-allocation";
import { quarterlySignalEngine } from "./quarterly-signal-engine";
import { tacticalAllocationEngine } from "./tactical-engine";
import { twoFundsEngine } from "./two-funds-engine";
import {trinityEngine} from "./trinity-engine";

const engines = new Map<string, StrategyEngine>([
  [valueTargetEngine.key, valueTargetEngine],
  [fixedAllocationEngine.key, fixedAllocationEngine],
  [quarterlySignalEngine.key, quarterlySignalEngine],
  [tacticalAllocationEngine.key,tacticalAllocationEngine],
  [twoFundsEngine.key, twoFundsEngine],
  [trinityEngine.key, trinityEngine]
]);

export function getStrategyEngine(key: string) {
  const engine = engines.get(key);
  if (!engine) throw new Error("Unsupported strategy engine: " + key);
  return engine;
}

export function validateEngineConfig(key: string, config: Record<string, unknown>) {
  getStrategyEngine(key).validateConfig(config);
}

export function supportedEngineKeys() {
  return [...engines.keys()];
}

/**
 * Engine presence means it is available for internal calculation and research,
 * NOT that an admin can publish it to customers. Require separate release review.
 */
const customerPublishableEngines = new Set(["FIXED_ALLOCATION","TACTICAL_ALLOCATION","TWO_FUNDS_MODERATE","TRINITY_HYBRID","QUARTERLY_SIGNAL_TARGET"]);
export function assertCustomerPublishableEngine(key:string) {
  if (customerPublishableEngines.has(key)) { getStrategyEngine(key); return; }
  // The legacy 9Sig engine (VALUE_TARGET) keeps old ledgers readable but is never offered to customers;
  // only the disposable CI fixture still starts it, to exercise the real onboarding paths.
  if (key === "VALUE_TARGET" && syntheticCatalogueFixtureAllowed()) { getStrategyEngine(key); return; }
  throw new Error("ENGINE_NOT_CUSTOMER_VERIFIED");
}
