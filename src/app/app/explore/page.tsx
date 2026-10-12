import Link from "next/link";
import { ArrowRight, BarChart3 } from "lucide-react";
import { requirePageUser } from "@/lib/session";
import { sql } from "@/lib/db";
import { listAvailableStrategies, listUserStrategies } from "@/lib/strategy-service";
import { loadEntitlements } from "@/lib/entitlement-service";
import { VERIFIED_MARKET_MAPPINGS_SQL, verifiedCandidates } from "@/lib/verified-market-mappings";
import { LEVERAGE_DISCLOSURE, STRATEGY_PLUGINS, curatedRelease } from "@/domain/strategy/catalog";
import { assertCuratedRules } from "@/domain/strategy/curated-release";
import { assessStrategyMarket } from "@/domain/strategy/market-eligibility";
import { EXPLORE_STATE_LABEL, GENERIC_RISK_NOTE, cardDescription, exploreCardState, summariseRules } from "@/domain/explore-catalogue";

export const dynamic = "force-dynamic";

export default async function ExplorePage() {
  const user = await requirePageUser();
  const [definitions, available, existing, entitlements, mappingRows] = await Promise.all([
    sql.unsafe("SELECT key,enabled FROM strategy_definitions"),
    listAvailableStrategies(),
    listUserStrategies(user.id),
    loadEntitlements(user.id),
    sql.unsafe(VERIFIED_MARKET_MAPPINGS_SQL)
  ]);
  const candidates = verifiedCandidates(mappingRows);
  const asOf = new Date().toISOString().slice(0, 10);
  const activeCount = existing.filter((strategy: any) => strategy.status === "ACTIVE").length;
  const atLimit = entitlements.maxActiveStrategies !== null && activeCount >= entitlements.maxActiveStrategies;
  const definitionByKey = new Map(definitions.map((row: any) => [String(row.key), row]));
  const releaseByKey = new Map(available.map((row: any) => [String(row.key), row]));
  const brand = process.env.NEXT_PUBLIC_BRAND_NAME?.trim() || "Wealtharr";

  const cards = STRATEGY_PLUGINS.map((plugin) => {
    const definition: any = definitionByKey.get(plugin.key);
    const release: any = releaseByKey.get(plugin.key);
    const catalogueRelease = curatedRelease(plugin);
    let rulesVerified = false;
    let marketVerified = false;
    if (release) {
      try {
        assertCuratedRules(plugin.key, String(release.engine_key), release.config, release.input_schema, String(release.version));
        rulesVerified = true;
      } catch { rulesVerified = false; }
      if (rulesVerified) {
        marketVerified = assessStrategyMarket(String(release.engine_key), (release.config ?? {}) as Record<string, unknown>,
          candidates, { country: user.country, wrapper: user.country === "GB" ? "ISA" : "TAXABLE", currency: user.baseCurrency }, asOf
        ).supportedMarkets.length > 0;
      }
    }
    const summary = summariseRules(plugin);
    const result = exploreCardState({
      engine: catalogueRelease?.engine ?? plugin.profile?.engine ?? plugin.seedDefinition?.engine ?? null,
      hasRules: Boolean(catalogueRelease?.config),
      definitionEnabled: definition?.enabled === true,
      publishedInWindow: Boolean(release),
      rulesVerified,
      marketVerified
    }, {
      atLimit,
      inPlan: entitlements.availableStrategyKeys ? entitlements.availableStrategyKeys.has(plugin.key) : true
    });
    return {
      key: plugin.key,
      name: String(plugin.seedDefinition?.name ?? plugin.profile?.name ?? plugin.key),
      description: cardDescription(plugin),
      summary,
      disclosure: plugin.profile?.disclosure ?? (summary.leveraged ? LEVERAGE_DISCLOSURE : null),
      result
    };
  });
  const order = { AVAILABLE: 0, COMING_SOON: 1, RESEARCH: 2 } as const;
  const sorted = [...cards].sort((a, b) => order[a.result.state] - order[b.result.state]);

  return <>
    <div className="page-title">
      <div>
        <div className="eyebrow">Explore / Strategies</div>
        <h1>Strategy catalogue, in plain English.</h1>
        <p>{brand} does not choose a strategy for you and this is not suitability advice. Each card describes a published set of rules; it does not promise or imply any return. Check that a strategy fits your own circumstances before you start it.</p>
      </div>
      <Link className="button" href="/app/community"><BarChart3 size={16}/>Community stats</Link>
    </div>
    <div className="strategy-grid">
      {sorted.map((card) => <section className="glass form-card explore-card" key={card.key} data-strategy-key={card.key} data-state={card.result.state}>
        <div className="strategy-meta">
          <span className={"pill "+(card.result.state==="AVAILABLE"?"good":card.result.state==="COMING_SOON"?"warn":"")}>{EXPLORE_STATE_LABEL[card.result.state]}</span>
        </div>
        <h2>{card.name}</h2>
        {card.description&&<p className="help">{card.description}</p>}
        {card.summary.allocations.length>0&&<>
          <p className="help">Target weights of each type of investment{card.summary.reviewFrequency?`, reviewed ${card.summary.reviewFrequency}`:""}:</p>
          <ul>{card.summary.allocations.map((row) => <li key={row.exposure}>{row.percent}% {row.label}</li>)}</ul>
        </>}
        {card.summary.allocations.length===0&&card.summary.targetExposure&&
          <p className="help">Follows a target value for: {card.summary.targetExposure}{card.summary.reviewFrequency?`, reviewed ${card.summary.reviewFrequency}`:""}.</p>}
        {card.disclosure&&<p className="help">{card.disclosure}</p>}
        {card.result.state==="AVAILABLE"&&<p className="help">{GENERIC_RISK_NOTE}</p>}
        {card.result.reason&&<p className="help">{card.result.reason}</p>}
        {card.result.startAction==="START"&&
          <Link className="button primary" href={"/app/strategies/new?strategy="+encodeURIComponent(card.key)}>Start this strategy <ArrowRight size={16}/></Link>}
        {card.result.startAction==="PLAN_OPTIONS"&&
          <Link className="button" href="/app/settings#plan">See plan options <ArrowRight size={16}/></Link>}
      </section>)}
    </div>
  </>;
}
