import type { StrategyEngine } from "./types";
import { valueTargetEngine } from "./value-target";
import { fixedAllocationEngine } from "./fixed-allocation";
import { momentumRotationEngine } from "./momentum-rotation";
import { tacticalAllocationEngine } from "./tactical-engine";

const engines = new Map<string, StrategyEngine>([
  [valueTargetEngine.key, valueTargetEngine],
  [fixedAllocationEngine.key, fixedAllocationEngine],
  [momentumRotationEngine.key, momentumRotationEngine],
  [tacticalAllocationEngine.key,tacticalAllocationEngine]
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
const customerPublishableEngines = new Set(["VALUE_TARGET","FIXED_ALLOCATION"]);
export function assertCustomerPublishableEngine(key:string) {
  if (!customerPublishableEngines.has(key)) throw new Error("ENGINE_NOT_CUSTOMER_VERIFIED");
  getStrategyEngine(key);
}
