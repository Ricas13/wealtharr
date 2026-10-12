import type {StrategyPlugin} from "./catalog/plugin";

/**
 * Explicit source-review sign-off is a code release, not a seed side effect. Empty until the
 * owner obtains independent methodology, regional trading and commercial approvals.
 * Register only fully certified versions here in a future reviewed release.
 * Historical instances remain in the database; this controls INSERTS on fresh installs only.
 */
export const SHIPPING_STRATEGY_KEYS:readonly string[]=[];

/** Run incomplete strategy fixtures only in GitHub's disposable PostgreSQL test DB. */
export function isDisposableStrategyTestSeed(env:Record<string,string|undefined>,url:string):boolean{
  return env.GITHUB_ACTIONS==="true"&&env.CI==="true"&&
    /^postgres(?:ql)?:\/\/[^@]+@127\.0\.0\.1:5432\/strategyos_test$/.test(url);
}

/** Never install draft/research strategies in an ordinary production bootstrap. */
export function seedableStrategies(plugins:readonly StrategyPlugin[],disposableTestDb:boolean):StrategyPlugin[]{
  if(disposableTestDb)return [...plugins];
  const approved=new Set(SHIPPING_STRATEGY_KEYS);
  return plugins.filter(plugin=>
    approved.has(plugin.key)&&plugin.seedDefinition?.initialVersion==="PUBLISHED"&&
    Boolean(plugin.specCard&&plugin.goldenTests)
  );
}
