import {STRATEGY_PLUGINS} from "./catalog";
import type {StrategyProfile} from "./catalog/plugin";

/**
 * Research-backed reference profiles. These are NOT automatically published:
 * regulated instruments, regional wrappers and live quotes must be verified first.
 * Allocation exposures are abstract asset classes rather than ticker guarantees.
 *
 * The data lives in one plugin file per strategy under `./catalog`; this module only derives the
 * reference list (in registry order) so existing importers keep working unchanged.
 */
export type {StrategyProfile} from "./catalog/plugin";
export {LEVERAGE_DISCLOSURE} from "./catalog/plugin";

export const RESEARCH_STRATEGIES: readonly StrategyProfile[] =
  STRATEGY_PLUGINS.flatMap(plugin=>plugin.profile?[plugin.profile]:[]);
