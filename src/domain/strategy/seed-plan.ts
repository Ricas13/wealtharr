import type {SeedDefinition,StrategyPlugin} from "./catalog/plugin";
import {isMethodComplete} from "./method-complete";

/**
 * Which strategy definitions `scripts/seed.ts` inserts, and how.
 *
 *  - CI_FIXTURE (the guarded, disposable CI database only): every plugin with a seed definition,
 *    exactly as declared. This keeps the historical test catalogue available to tests.
 *  - PRODUCTION (any real install): ONLY plugins whose method is complete (`isMethodComplete`), and
 *    always as a DISABLED definition with a PUBLISHED version "1.0". The seed never writes an
 *    attestation row. An administrator enables a strategy later, and only a complete EXACT market
 *    makes it reachable by customers. Incomplete plugins are never seeded.
 *
 * The seed itself stays insert-only (`ON CONFLICT DO NOTHING`): an existing definition or version
 * is never modified.
 */
export type SeedMode="CI_FIXTURE"|"PRODUCTION";
export type SeedEntry={
  plugin:StrategyPlugin;
  definition:SeedDefinition;
  enabled:boolean;
  initialVersion:"PUBLISHED"|"DRAFT"|null;
  realignsResearchOnlyDefinition:boolean;
};

export function strategiesToSeed(plugins:readonly StrategyPlugin[],mode:SeedMode):SeedEntry[]{
  const entries:SeedEntry[]=[];
  for(const plugin of plugins){
    const definition=plugin.seedDefinition;
    if(!definition)continue;
    if(mode==="CI_FIXTURE"){
      entries.push({plugin,definition,enabled:definition.enabled,initialVersion:definition.initialVersion,
        realignsResearchOnlyDefinition:definition.realignsResearchOnlyDefinition});
      continue;
    }
    if(!isMethodComplete(plugin))continue;
    // A complete method is seeded disabled and published, and never realigns an older research row.
    entries.push({plugin,definition,enabled:false,initialVersion:"PUBLISHED",realignsResearchOnlyDefinition:false});
  }
  return entries;
}
