import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, ArrowRight, BarChart3, CalendarClock, ChevronRight, Sparkles, WalletCards } from "lucide-react";
import { requirePageUser } from "@/lib/session";
import { getStrategyForUser, listAvailableStrategies, listStrategyAccounts } from "@/lib/strategy-service";
import { sql } from "@/lib/db";
import {isStoredActionCurrent,STALE_ACTION_DISPLAY} from "@/lib/action-service";
import { loadEntitlements } from "@/lib/entitlement-service";
import { simulateSameCashFlows } from "@/domain/comparison";
import { PerformanceChart } from "@/components/PerformanceChart";
import { benchmarkComparison, loadWorkspaceAnalytics } from "@/lib/workspace-analytics";
import { growthIndex, summarizeObservedPerformance } from "@/domain/portfolio-analytics";
import { initialAllocationPlan } from "@/domain/initial-allocation";
import { assessStrategyMarket } from "@/domain/strategy/market-eligibility";
import { VERIFIED_MARKET_MAPPINGS_SQL, verifiedCandidates } from "@/lib/verified-market-mappings";
import { HistoricalQuoteLookup } from "@/components/HistoricalQuoteLookup";
import { BrokerTradeForm } from "@/components/BrokerTradeForm";
import { ManualPriceForm } from "@/components/ManualPriceForm";
import { actionRecoveryGuidance, plainEnglishActionReason } from "@/domain/action-copy";
import { AddLinkedAccountForm, CashEventForm, ContributionForm, ContributionPlanForm, ExecuteAction, ExecutionConstraintsForm, OpeningSnapshotForm, RecalculateButton, ReconcileForm, ReverseLedgerEventButton, StrategyLifecycleControls, StrategySwitchControl, StrategyVersionUpgrade, WhatIfPreview } from "@/components/StrategyActions";

function money(value:number,currency:string){
  return new Intl.NumberFormat("en-GB",{style:"currency",currency,maximumFractionDigits:0}).format(value);
}

function readableExposure(value:unknown){
  return String(value??"").replaceAll("_"," ").replace(/\b\w/g,(letter)=>letter.toUpperCase());
}

function percent(value:unknown){
  const number=Number(value);
  return Number.isFinite(number)?new Intl.NumberFormat("en-GB",{style:"percent",maximumFractionDigits:2}).format(number):"—";
}

function strategyRuleRows(engine:string,config:Record<string,unknown>){
  if(engine==="VALUE_TARGET"){
    return [
      {label:"Target exposure",value:readableExposure(config.targetExposure)},
      {label:"Review rhythm",value:readableExposure(config.reviewFrequency??"Quarterly")},
      {label:"Target growth per review",value:percent(config.targetRate??0)},
      {label:"New-money target share",value:percent(config.contributionTargetRatio??0)},
      {label:"Trade tolerance",value:percent(config.tolerance??0)},
      {label:"Maximum cash used per action",value:percent(config.maxCashUse??1)}
    ];
  }
  if(engine==="FIXED_ALLOCATION"){
    const allocations=Array.isArray(config.allocations)?config.allocations as Array<Record<string,unknown>>:[];
    return [
      ...allocations.map((allocation)=>({label:readableExposure(allocation.exposure),value:percent(allocation.weight)})),
      {label:"Review rhythm",value:readableExposure(config.reviewFrequency??"Quarterly")},
      {label:"Rebalance threshold",value:percent(config.rebalanceThreshold??0)}
    ];
  }
  return Object.entries(config)
    .filter(([,value])=>["string","number","boolean"].includes(typeof value))
    .slice(0,8)
    .map(([key,value])=>({label:readableExposure(key),value:String(value)}));
}

export default async function StrategyPage({params}:{params:Promise<{id:string}>}){
  const user=await requirePageUser();
  const {id}=await params;
  const s:any=await getStrategyForUser(user.id,id);
  if(!s)notFound();
  const [entitlements,strategyAccounts,availableStrategies]=await Promise.all([
    loadEntitlements(user.id),
    listStrategyAccounts(user.id,id),
    listAvailableStrategies()
  ]);
  const canWhatIf=entitlements.features.has("what_if");
  const canMultiAccount=entitlements.features.has("multi_account");
  const accountOptions=strategyAccounts.map((account:any)=>({
    id:String(account.id),
    name:String(account.name),
    wrapper:String(account.wrapper),
    currency:String(account.currency),
    brokerName:account.broker_name?String(account.broker_name):null,
    role:String(account.role),
    ledgerEventCount:Number(account.ledger_event_count??0),
    openingSnapshotComplete:Number(account.opening_event_count??0)>0
  }));
  const supportedWrappers=Array.isArray(s.supported_wrappers)?s.supported_wrappers.map(String):[];
  const switchOptions=availableStrategies
    .filter((strategy:any)=>String(strategy.key)!==String(s.strategy_key))
    .filter((strategy:any)=>!entitlements.availableStrategyKeys||entitlements.availableStrategyKeys.has(String(strategy.key)))
    .filter((strategy:any)=>{
      const regions=Array.isArray(strategy.supported_regions)?strategy.supported_regions.map(String):[];
      const wrappers=Array.isArray(strategy.supported_wrappers)?strategy.supported_wrappers.map(String):[];
      return strategyAccounts.every((account:any)=>
        (!regions.length||regions.includes(String(account.country)))&&
        (!wrappers.length||wrappers.includes(String(account.wrapper)))
      );
    })
    .map((strategy:any)=>({
      key:String(strategy.key),
      name:String(strategy.name),
      version:String(strategy.version),
      inputSchema:Array.isArray(strategy.input_schema)?strategy.input_schema:[]
    }));

  const actionRows=await sql.unsafe("SELECT a.id,a.action_type,a.status,a.title,a.instruction,a.amount,a.currency,a.explanation,a.confidence,a.due_at,a.created_at,acc.name AS account_name,acc.wrapper AS account_wrapper FROM actions a LEFT JOIN accounts acc ON acc.id=a.account_id WHERE a.strategy_instance_id=$1 AND a.status IN ('CALCULATED','NOTIFIED','ACKNOWLEDGED') ORDER BY a.created_at DESC LIMIT 1",[id]);
  const storedAction=actionRows[0];
  const action=storedAction&&!(await isStoredActionCurrent(id,String(storedAction.id)))
    ?{...storedAction,...STALE_ACTION_DISPLAY}:storedAction;
  const priceOptions=await sql.unsafe(
    "SELECT DISTINCT ON (i.id) i.id,tl.ticker,tl.exchange,tl.currency "+
    "FROM strategy_accounts sa JOIN accounts a ON a.id=sa.account_id "+
    "JOIN trading_lines tl ON upper(tl.currency)=upper(a.currency) "+
    "JOIN instruments i ON i.id=tl.instrument_id "+
    "WHERE sa.strategy_instance_id=$1 AND tl.effective_from<=current_date "+
    "AND (tl.effective_to IS NULL OR tl.effective_to>=current_date) AND ("+
    " EXISTS(SELECT 1 FROM ledger_events le WHERE le.strategy_instance_id=$1 AND le.instrument_id=i.id) "+
    " OR EXISTS(SELECT 1 FROM regional_instrument_mappings m WHERE m.trading_line_id=tl.id AND m.enabled=true AND m.fidelity='EXACT' AND m.country=a.country "+
    " AND m.wrapper=a.wrapper AND (m.broker IS NULL OR upper(m.broker)=upper(COALESCE(a.broker_name,''))))) "+
    "ORDER BY i.id,tl.ticker,tl.id LIMIT 40",[id]
  );


  const performance=await sql.unsafe("SELECT date,series_type,value FROM performance_series WHERE strategy_instance_id=$1 ORDER BY date",[id]);
  const actualPoints=performance
    .filter((p:any)=>p.series_type==="USER_VALUE")
    .map((p:any)=>({date:String(p.date).slice(0,10),value:String(p.value)}));

  const canonical=await sql.unsafe(
    "SELECT date,value,benchmark_value FROM canonical_model_performance WHERE strategy_version_id=$1 ORDER BY date",
    [s.strategy_version_id]
  );
  const configuredBenchmarkRows=await sql.unsafe(
    "SELECT b.key,svb.label,svb.default_visible,svb.sort_order,bp.date,bp.value FROM strategy_version_benchmarks svb JOIN benchmarks b ON b.id=svb.benchmark_id JOIN benchmark_performance bp ON bp.benchmark_id=b.id WHERE svb.strategy_version_id=$1 ORDER BY svb.sort_order,b.key,bp.date",
    [s.strategy_version_id]
  );
  const externalFlows=await sql.unsafe(
    "SELECT l.occurred_at::date AS date,l.event_type,l.cash_amount FROM ledger_events l WHERE l.strategy_instance_id=$1 AND l.event_type IN ('CONTRIBUTION','WITHDRAWAL') AND NOT EXISTS (SELECT 1 FROM ledger_events c WHERE c.correction_of_event_id=l.id) ORDER BY l.occurred_at,l.created_at",
    [id]
  );
  const reviewEvents=await sql.unsafe(
    "SELECT executed_at::date AS date,title FROM actions WHERE strategy_instance_id=$1 AND status='EXECUTED' AND action_type IN ('BUY','SELL','REBALANCE','HOLD') AND executed_at IS NOT NULL ORDER BY executed_at",
    [id]
  );

  const byDate=new Map<string,{date:string;actual?:number;model?:number;benchmark?:number;benchmarkValues?:Record<string,number>}>();
  const comparisonWarnings:string[]=[];
  for(const point of actualPoints){
    byDate.set(point.date,{date:point.date,actual:Number(point.value)});
  }

  if(actualPoints.length&&canonical.length){
    const anchor=actualPoints[0];
    const flows=externalFlows.map((flow:any)=>({date:String(flow.date).slice(0,10),amount:String(flow.cash_amount)}));
    try{
      const model=simulateSameCashFlows({
        index:canonical.map((p:any)=>({date:String(p.date).slice(0,10),value:String(p.value)})),
        anchorDate:anchor.date,
        anchorValue:anchor.value,
        flows
      });
      for(const point of model){
        const item=byDate.get(point.date)??{date:point.date};
        item.model=point.value.toNumber();
        byDate.set(point.date,item);
      }
    }catch{
      comparisonWarnings.push("Strategy-model comparison is unavailable for part of this history because a withdrawal exceeds the counterfactual value.");
    }

    const benchmarkIndex=canonical
      .filter((p:any)=>p.benchmark_value!=null)
      .map((p:any)=>({date:String(p.date).slice(0,10),value:String(p.benchmark_value)}));
    if(benchmarkIndex.length){
      try{
        const benchmark=simulateSameCashFlows({
          index:benchmarkIndex,
          anchorDate:anchor.date,
          anchorValue:anchor.value,
          flows
        });
        for(const point of benchmark){
          const item=byDate.get(point.date)??{date:point.date};
          item.benchmark=point.value.toNumber();
          byDate.set(point.date,item);
        }
      }catch{
        comparisonWarnings.push("Benchmark comparison is unavailable for part of this history because a withdrawal exceeds the counterfactual value.");
      }
    }
  }


  const comparisonSeriesMap=new Map<string,{key:string;label:string;defaultVisible:boolean;points:Array<{date:string;value:string}>}>();
  for(const row of configuredBenchmarkRows){
    const key=String(row.key);
    const item=comparisonSeriesMap.get(key)??{key,label:String(row.label),defaultVisible:Boolean(row.default_visible),points:[]};
    item.points.push({date:String(row.date).slice(0,10),value:String(row.value)});
    comparisonSeriesMap.set(key,item);
  }
  const comparisonSeries=[...comparisonSeriesMap.values()];
  if(actualPoints.length&&comparisonSeries.length){
    const anchorPoint=actualPoints[0];
    const flows=externalFlows.map((flow:any)=>({date:String(flow.date).slice(0,10),amount:String(flow.cash_amount)}));
    for(const series of comparisonSeries){
      try{
        const simulated=simulateSameCashFlows({index:series.points,anchorDate:anchorPoint.date,anchorValue:anchorPoint.value,flows});
        for(const point of simulated){
          const item=byDate.get(point.date)??{date:point.date};
          item.benchmarkValues={...(item.benchmarkValues??{}),[series.key]:point.value.toNumber()};
          byDate.set(point.date,item);
        }
      }catch{
        comparisonWarnings.push(series.label+" comparison is unavailable for part of this history because a withdrawal exceeds the counterfactual value.");
      }
    }
  }

  const chartMarkers=[
    ...externalFlows.filter((flow:any)=>String(flow.event_type)==="CONTRIBUTION").map((flow:any)=>({date:String(flow.date).slice(0,10),type:"CONTRIBUTION" as const,label:"Contribution"})),
    ...reviewEvents.map((event:any)=>({date:String(event.date).slice(0,10),type:"REVIEW" as const,label:String(event.title??"Strategy review")}))
  ];
  for(const marker of chartMarkers){
    if(!byDate.has(marker.date))byDate.set(marker.date,{date:marker.date});
  }
  const chartData=[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));
  const trackedFlows=externalFlows.map((row:any)=>({date:String(row.date).slice(0,10),amount:String(row.cash_amount)}));
  const trackSummary=summarizeObservedPerformance(actualPoints,trackedFlows);
  const workspace=await loadWorkspaceAnalytics(user.id);
  const trackedIndex=growthIndex(actualPoints,trackedFlows);
  const benchmark=benchmarkComparison(actualPoints,trackedFlows,String(s.currency),workspace.benchmarks);
  const mainChart=new Map<string,{date:string;actual?:number;benchmarkValues?:Record<string,number>}>();
  for(const point of trackedIndex)mainChart.set(point.date,{date:point.date,actual:Number(point.value)});
  for(const [date,values] of benchmark.mapped){const row=mainChart.get(date);if(row)row.benchmarkValues=values;}
  const performanceOverview=[...mainChart.values()].sort((a,b)=>a.date.localeCompare(b.date));
  const signedPct=(v:number|null|undefined)=>v==null?"—":new Intl.NumberFormat("en-GB",{style:"percent",maximumFractionDigits:2}).format(v/100);
  const contributions=await sql.unsafe("SELECT l.id,l.occurred_at,l.cash_amount,l.provenance,l.confidence FROM ledger_events l WHERE l.strategy_instance_id=$1 AND l.event_type='CONTRIBUTION' AND NOT EXISTS (SELECT 1 FROM ledger_events c WHERE c.correction_of_event_id=l.id) ORDER BY l.occurred_at DESC LIMIT 8",[id]);
  const reconciliations=await sql.unsafe("SELECT occurred_at,expected_value,broker_reported_value,difference,reason FROM reconciliations WHERE strategy_instance_id=$1 ORDER BY occurred_at DESC LIMIT 5",[id]);
  const cashEvents=await sql.unsafe("SELECT l.id,l.occurred_at,l.event_type,l.cash_amount,l.fee_amount,l.metadata FROM ledger_events l WHERE l.strategy_instance_id=$1 AND l.event_type IN ('WITHDRAWAL','DIVIDEND','DISTRIBUTION','INTEREST','FEE','TAX') AND NOT EXISTS (SELECT 1 FROM ledger_events c WHERE c.correction_of_event_id=l.id) ORDER BY l.occurred_at DESC,l.created_at DESC LIMIT 12",[id]);
  const latestValue=actualPoints.at(-1);
  const explanation=Array.isArray(action?.explanation)?action.explanation:[];
  const needsOpeningSnapshot=Boolean(s.state?.resumeNeedsReconciliation);
  const pendingOpeningAccounts=accountOptions.filter((account)=>account.ledgerEventCount===0);
  const capturedOpeningAccountCount=accountOptions.length-pendingOpeningAccounts.length;
  const hasVersionUpdate=Boolean(s.latest_version_id)&&String(s.latest_version_id)!==String(s.strategy_version_id);
  const isHealthy=s.health_status==="HEALTHY";
  const isActive=s.status==="ACTIVE";
  const actionReady=Boolean(action)&&isActive;
  const nextReview=action?.due_at?new Date(action.due_at):null;
  const plainReason=action?plainEnglishActionReason({actionType:String(action.action_type),instruction:String(action.instruction??"")}):null;
  const recovery=action?actionRecoveryGuidance({actionType:String(action.action_type),instruction:String(action.instruction??"")}):null;
  const ruleRows=strategyRuleRows(String(s.engine),(s.config??{}) as Record<string,unknown>);
  let firstAllocation:ReturnType<typeof initialAllocationPlan>=null;
  if(String(s.onboarding_mode)==="START_NEW"&&accountOptions.length===1&&isActive){
    const cashRows=await sql.unsafe("SELECT COALESCE(sum(l.cash_amount-l.fee_amount),0) AS cash, "+
      "count(*) FILTER (WHERE l.event_type IN ('BUY','SELL'))::int AS trades FROM ledger_events l "+
      "WHERE l.strategy_instance_id=$1 AND NOT EXISTS (SELECT 1 FROM ledger_events c WHERE c.correction_of_event_id=l.id)",[id]);
    if(Number(cashRows[0]?.trades??0)===0&&Number(cashRows[0]?.cash??0)>0){
      const choice={country:String(s.country),wrapper:String(s.wrapper),currency:String(s.currency),broker:s.broker_name?String(s.broker_name):null};
      const eligible=assessStrategyMarket(String(s.engine),(s.config??{}) as Record<string,unknown>,
        verifiedCandidates(await sql.unsafe(VERIFIED_MARKET_MAPPINGS_SQL)),choice,new Date().toISOString().slice(0,10));
      if(eligible.available)firstAllocation=initialAllocationPlan(String(s.engine),(s.config??{}) as Record<string,unknown>,
        String(cashRows[0].cash),String(s.currency),eligible.positions);
    }
  }
  const canSeeTechnicalConfig=user.role==="ADMIN"||!Boolean(s.proprietary);

  return <>
    <Link href="/app/strategies" className="back-link"><ArrowLeft size={14}/>Portfolio</Link>

    <div className="strategy-heading">
      <div>
        <div className="eyebrow">{s.strategy_name} · v{s.version}</div>
        <h1>{s.name}</h1>
        <p>{s.description}</p>
      </div>
      <div className="strategy-heading-actions">
        <span className={"pill "+(isHealthy?"good":"warn")}>{isHealthy?"On track":"Needs attention"}</span>
        {isActive&&<RecalculateButton id={id}/>}
      </div>
    </div>

    {needsOpeningSnapshot?<section className="glass resume-focus">
      <div className="resume-focus-icon"><WalletCards size={24}/></div>
      <div>
        <div className="eyebrow">One last step</div>
        <h2>Tell us what you own today.</h2>
        <p>You do not need to rebuild your old transaction history. Enter your current cash and holdings so we can calculate from here.</p>
      </div>
      {accountOptions.length>1&&capturedOpeningAccountCount>0&&pendingOpeningAccounts[0]&&<div className="resume-progress" role="status">
        <strong>Next: {pendingOpeningAccounts[0].name}</strong><small>{pendingOpeningAccounts[0].wrapper} · {pendingOpeningAccounts[0].currency}</small>
      </div>}
      <OpeningSnapshotForm id={id} accounts={accountOptions}/>
      {canMultiAccount&&<details className="resume-add-account">
        <summary>Add another account first</summary>
        <p className="help">If this strategy already spans another account, link it now and then enter that account’s current holdings too.</p>
        <AddLinkedAccountForm id={id} currency={String(s.currency)} wrappers={supportedWrappers}/>
      </details>}
    </section>:<section className={"glass strategy-focus "+(isHealthy?"healthy":"attention")}>
      <div className="strategy-focus-main">
        <div className="focus-topline">
          <span className="soft-label">{isActive?"What to do now":"Strategy status"}</span>
          {action?.confidence&&<span className={"pill "+(action.confidence==="HIGH"?"good":"warn")}>{action.confidence} confidence</span>}
        </div>
        <h2>{actionReady?action.title:isActive?"Nothing to do right now.":"Strategy "+String(s.status).toLowerCase()}</h2>
        <p>{actionReady?action.instruction:isActive?"We will show your next action here as soon as the strategy needs you.":"Resume this strategy when you want new actions to be calculated."}</p>
        {actionReady&&accountOptions.length>1&&action.account_name&&<div className="action-account-hint"><WalletCards size={14}/><span>Use <strong>{String(action.account_name)}</strong>{action.account_wrapper?" · "+String(action.account_wrapper):""}</span></div>}
        {actionReady&&plainReason&&<div className="plain-reason"><Sparkles size={14}/><span>{plainReason}</span></div>}
        {action&&isActive&&action.action_type!=="DATA_REQUIRED"&&action.action_type!=="NO_ACTION"&&<div className="focus-action"><ExecuteAction action={{id:String(action.id),actionType:String(action.action_type)}}/></div>}
      </div>

      <div className="strategy-focus-side">
        <div className="focus-stat">
          <span>Current value</span>
          <strong>{latestValue?money(Number(latestValue.value),s.currency):"—"}</strong>
        </div>
        <div className="focus-stat">
          <span>Next review</span>
          <strong>{nextReview?nextReview.toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}):"When needed"}</strong>
        </div>
        <div className="focus-stat">
          <span>Account</span>
          <strong>{accountOptions.length>1?accountOptions.length+" accounts":s.wrapper}</strong>
        </div>
      </div>

      {explanation.length>0&&<details className="focus-why">
        <summary>Why this action? <ChevronRight size={15}/></summary>
        <div>{explanation.map((row:any,i:number)=><div className="why-row" key={i}><span>{row.label}</span><b>{row.value}</b></div>)}</div>
      </details>}
    </section>}

    {!isHealthy&&!needsOpeningSnapshot&&<div className="attention-banner recovery-banner" role="status">
      <div className="recovery-banner-icon"><AlertTriangle size={19}/></div>
      <div className="recovery-banner-copy">
        <strong>{action?.action_type==="DATA_REQUIRED"?"Your next action is safely paused.":"We need a little more information before we can be fully confident."}</strong>
        <span>{action?.action_type==="DATA_REQUIRED"?String(action.instruction):"We will never guess when holdings, prices, FX or reconciliation data is uncertain."}</span>
      </div>
      {recovery&&<a className="button compact" href={recovery.href}>{recovery.label}<ArrowRight size={14}/></a>}
    </div>}

    {hasVersionUpdate&&<div id="strategy-update"><StrategyVersionUpgrade id={id} currentVersion={String(s.version)} targetVersionId={String(s.latest_version_id)} targetVersion={String(s.latest_version)} releaseNotes={s.latest_release_notes?String(s.latest_release_notes):null} upgradePolicy={String(s.latest_upgrade_policy??"OPTIONAL")} inputSchema={Array.isArray(s.latest_input_schema)?s.latest_input_schema:[]} currentSettings={(s.settings??{}) as Record<string,unknown>} currentConfig={(s.config??{}) as Record<string,unknown>} targetConfig={(s.latest_config??{}) as Record<string,unknown>}/></div>}

    <section className="glass workspace-analytics" aria-label="Strategy performance comparison">
      <div className="section-head"><div><div className="eyebrow">Your investment performance</div><h2>Progress and benchmarks</h2>
        <p>Measured since the first recorded portfolio value. Contributions and withdrawals are not counted as profit.</p></div></div>
      <div className="analytics-stats">
        <div className="kpi"><span>Profit / loss since tracking began</span><strong>{trackSummary?money(Number(trackSummary.profitSinceStart),String(s.currency)):"—"}</strong></div>
        <div className="kpi"><span>Flow-adjusted return (estimate)</span><strong>{signedPct(trackSummary?.flowAdjustedReturnPct)}</strong></div>
        <div className="kpi"><span>Observed maximum drawdown</span><strong>{signedPct(trackSummary?.observedMaxDrawdownPct)}</strong></div>
        <div className="kpi"><span>Last observed session P/L</span><strong>{trackSummary?.lastObservedSessionPnl!=null?money(Number(trackSummary.lastObservedSessionPnl),String(s.currency)):"—"}</strong></div>
      </div>
      {performanceOverview.length>=2?<div className="chart-card">
        <PerformanceChart data={performanceOverview} comparisons={benchmark.comparisons} indexed fullControls actualLabel={String(s.strategy_name)}/>
        {benchmark.missing.length>0&&<p className="help comparison-warning">VTI / SPY / QQQ still missing verified, same-currency total-return history for: {benchmark.missing.join(", ")}. Unavailable benchmarks are not estimated.</p>}
      </div>:<p className="help">We need two reliable dated portfolio valuations before we can calculate returns or drawdowns. Past broker performance is not guessed when you resume a strategy.</p>}
      {trackSummary&&<p className="help">Best observed session: {signedPct(trackSummary.bestObservedSessionPct)} · Worst observed session: {signedPct(trackSummary.worstObservedSessionPct)} · Current observed drawdown: {signedPct(trackSummary.currentDrawdownPct)}. Sparse data may miss intraday declines.</p>}
    </section>

    {firstAllocation&&<section className="glass workspace-analytics" aria-label="Your starting allocation">
      <div className="section-head"><div><div className="eyebrow">Starting this strategy</div><h2>Your first purchases</h2>
        <p>This is the fixed allocation from your selected strategy, automatically mapped to verified {String(s.wrapper)} instruments. Prices and share quantities are confirmed using your broker.</p></div></div>
      <div className="initial-order-list">{firstAllocation.orders.map(order=><div className="initial-order" key={order.exposure}>
        <div><strong>{order.ticker}</strong><small>{order.exchange} · {order.weight}% allocation</small></div>
        <strong>{money(Number(order.amount),firstAllocation.currency)}</strong>
      </div>)}
      {Number(firstAllocation.cashReserve)>0&&<div className="initial-order">
        <div><strong>Cash reserve</strong><small>Retained under this strategy&apos;s published rules</small></div>
        <strong>{money(Number(firstAllocation.cashReserve),firstAllocation.currency)}</strong>
      </div>}</div>
      <p className="help">Amounts are before dealing fees and subject to market moves. After trading, record the real timestamp, quantity, execution price and fees so your portfolio and next review are accurate.</p>
      <a className="button primary compact" href="#portfolio-update">Record my purchases <ArrowRight size={14}/></a>
    </section>}

    <div className="strategy-shortcuts">
      <details className="glass quick-drawer" id="portfolio-update">
        <summary><span><WalletCards size={18}/>Update portfolio</span><ChevronRight size={16}/></summary>
        <div className="quick-drawer-content">
          <div className="detail-grid">
            <section><h3>Add money</h3><p className="help">Record a contribution. Cash stays cash until a purchase is confirmed.</p><ContributionForm id={id} accounts={accountOptions}/></section>
            <section><h3>Other cash movement</h3><p className="help">Withdrawals, dividends, interest, fees and tax belong here.</p><CashEventForm id={id} accounts={accountOptions}/></section>
          </div>
          <section className="drawer-section contribution-plan-settings"><h3>Regular contribution</h3><p className="help">Optional reminder only. Planned money never appears in your portfolio until you record the real deposit.</p><ContributionPlanForm id={id} plan={(s.contribution_plan??{}) as Record<string,unknown>}/></section>
          <section className="drawer-section"><HistoricalQuoteLookup accounts={accountOptions}/><BrokerTradeForm strategyId={id} accounts={accountOptions}/><ManualPriceForm strategyId={id} instruments={priceOptions.map((o:any)=>({id:String(o.id),ticker:String(o.ticker),exchange:String(o.exchange),currency:String(o.currency)}))}/></section>
          <section className="drawer-section"><h3>Match your broker</h3><p className="help">If the app and broker differ, reconcile them here. Unexplained differences block financial actions instead of being guessed.</p><ReconcileForm id={id} expected={accountOptions.length===1&&latestValue?Number(latestValue.value):null} accounts={accountOptions}/></section>
        </div>
      </details>

      <details className="glass quick-drawer">
        <summary><span><BarChart3 size={18}/>Explore performance & history</span><ChevronRight size={16}/></summary>
        <div className="quick-drawer-content">
          <section className="chart-card explore-chart">
            <div className="section-head"><div><h2>Performance</h2><p>Your account versus the same cash flows applied to the strategy model and benchmark.</p></div></div>
            <PerformanceChart data={chartData} markers={chartMarkers} comparisons={comparisonSeries.map(({key,label,defaultVisible})=>({key,label,defaultVisible}))} fullControls/>
            <p className="help">Contributions and withdrawals are applied across comparison series so adding money is not mistaken for investment performance.</p>
            {comparisonWarnings.map((warning)=><p className="help comparison-warning" key={warning}>{warning}</p>)}
            <div className="tracking-boundary"><span>Tracked by {process.env.NEXT_PUBLIC_BRAND_NAME?.trim()||"Wealtharr"} since {new Date(s.started_at).toLocaleDateString("en-GB",{day:"numeric",month:"long",year:"numeric"})}.</span>{s.onboarding_mode==="RESUME"&&<span>Performance before that date is not reconstructed from incomplete history.</span>}</div>
          </section>

          <div className="detail-grid history-grid">
            <section className="drawer-section"><h3>Recent contributions</h3>{contributions.length?contributions.map((c:any)=><div className="why-row" key={String(c.id)}><span>{new Date(c.occurred_at).toLocaleDateString("en-GB")}</span><span className="inline"><b>{new Intl.NumberFormat("en-GB",{style:"currency",currency:s.currency}).format(Number(c.cash_amount))}</b><ReverseLedgerEventButton strategyId={id} eventId={String(c.id)}/></span></div>):<p className="help">No contributions recorded yet.</p>}</section>
            <section className="drawer-section"><h3>Other cash events</h3>{cashEvents.length?cashEvents.map((event:any)=><div className="why-row" key={String(event.id)}><span>{new Date(event.occurred_at).toLocaleDateString("en-GB")} · {String(event.event_type).replaceAll("_"," ")}</span><span className="inline"><b>{new Intl.NumberFormat("en-GB",{style:"currency",currency:s.currency}).format(Math.abs(Number(event.cash_amount||event.fee_amount||0)))}</b><ReverseLedgerEventButton strategyId={id} eventId={String(event.id)}/></span></div>):<p className="help">No other cash events yet.</p>}</section>
          </div>
          <section className="drawer-section"><h3>Reconciliation history</h3>{reconciliations.length?reconciliations.map((r:any,i:number)=><div className="why-row" key={i}><span>{new Date(r.occurred_at).toLocaleDateString("en-GB")} · {r.reason??"Adjustment"}</span><b>{Number(r.difference).toFixed(2)}</b></div>):<p className="help">No reconciliations yet.</p>}</section>
        </div>
      </details>

      {canWhatIf&&      <details className="glass quick-drawer">
        <summary><span><Sparkles size={18}/>What if?</span><ChevronRight size={16}/></summary>
        <div className="quick-drawer-content">
          <div className="section-head"><div><h2>Preview a change.</h2><p>See what the strategy would say without touching your real portfolio.</p></div></div>
          <WhatIfPreview id={id} currency={String(s.currency)} switchOptions={switchOptions}/>
        </div>
      </details>}

      <details className="glass quick-drawer">
        <summary><span><CalendarClock size={18}/>Strategy settings & rules</span><ChevronRight size={16}/></summary>
        <div className="quick-drawer-content">
          <div className="detail-grid">
            <section className="drawer-section" id="strategy-health"><div className="eyebrow">Strategy health</div><h3>{isHealthy?"Everything looks good":"Needs attention"}</h3><p className="help">High-confidence actions are suppressed whenever critical holdings, FX, market data or reconciliation state is stale, missing or unresolved.</p><div className="strategy-meta"><span className="pill">Version {s.version}</span><span className="pill">{s.currency}</span><span className="pill">{s.onboarding_mode.replaceAll("_"," ")}</span><span className="pill">{s.status}</span></div></section>
            <section className="drawer-section"><div className="eyebrow">Lifecycle</div><h3>Pause, resume, switch or stop</h3><p className="help">These controls preserve your history. They never erase the journey you have already recorded.</p><StrategyLifecycleControls id={id} status={s.status}/>{s.status!=="CLOSED"&&switchOptions.length>0&&<details className="lifecycle-switch-details"><summary>Switch strategy</summary><p className="help">Preview the new strategy first. Switching closes this journey and starts the new one from your portfolio as it is today.</p><StrategySwitchControl id={id} options={switchOptions}/></details>}</section>
          </div>
          <section className="drawer-section linked-accounts-section">
            <div className="eyebrow">Linked accounts</div>
            <h3>{accountOptions.length>1?"One strategy, several accounts.":"Your strategy account"}</h3>
            <p className="help">{accountOptions.length>1?"Actions are calculated across these linked accounts, while cash movements and reconciliation stay attached to the account where they happened.":"You can keep this simple with one account. Add another only if the same strategy genuinely spans more than one account."}</p>
            <div className="linked-account-list">{strategyAccounts.map((account:any)=><div className="linked-account-card" key={String(account.id)}>
              <div><strong>{String(account.name)}</strong><span>{String(account.wrapper)}{account.broker_name?" · "+String(account.broker_name):""}</span></div>
              <div className="linked-account-meta"><span className="pill">{String(account.role)==="PRIMARY"?"Primary":"Linked"}</span><span className="pill">{String(account.currency)}</span></div>
            </div>)}</div>
            {canMultiAccount?<details className="linked-account-add"><summary>Add another account</summary><AddLinkedAccountForm id={id} currency={String(s.currency)} wrappers={supportedWrappers}/></details>:accountOptions.length===1?<p className="help">Multiple linked accounts are available on plans that include multi-account support.</p>:null}
            {!needsOpeningSnapshot&&accountOptions.some((account)=>account.ledgerEventCount===0&&(String(s.onboarding_mode)==="RESUME"||account.role!=="PRIMARY"))&&<details className="linked-account-add"><summary>Add current holdings to an empty linked account</summary><p className="help">Use this only for an account that already held investments before you linked it here.</p><OpeningSnapshotForm id={id} accounts={accountOptions.filter((account)=>account.ledgerEventCount===0&&(String(s.onboarding_mode)==="RESUME"||account.role!=="PRIMARY"))}/></details>}
          </section>
          <section className="drawer-section execution-settings" id="trade-preferences"><div className="eyebrow">Trade preferences</div><h3>Make the strategy fit your broker.</h3><p className="help">These preferences change how an ideal strategy action is translated into a practical order. They do not change the strategy rules themselves.</p><ExecutionConstraintsForm id={id} constraints={(s.execution_constraints??{}) as Record<string,unknown>}/></section>
          <section className="drawer-section rules-section">
            <div className="eyebrow">Rules & disclosure</div>
            <h3>How this version operates</h3>
            <p>{s.disclosure}</p>
            <div className="rule-summary-grid">{ruleRows.map((row)=><div className="rule-summary-row" key={row.label}><span>{row.label}</span><strong>{row.value}</strong></div>)}</div>
            {canSeeTechnicalConfig?<details><summary>Show technical configuration</summary><pre>{JSON.stringify(s.config,null,2)}</pre></details>:<p className="help">The customer view shows the operational rules you need without exposing the strategy author&apos;s internal configuration format.</p>}
          </section>
        </div>
      </details>
    </div>
  </>;
}
