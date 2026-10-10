import Link from "next/link";
import { ArrowRight, CheckCircle2, Plus, Sparkles } from "lucide-react";
import { requirePageUser } from "@/lib/session";
import { listUserStrategies } from "@/lib/strategy-service";
import { sql } from "@/lib/db";
import {isStoredActionCurrent,STALE_ACTION_DISPLAY} from "@/lib/action-service";
import { plainEnglishActionReason } from "@/domain/action-copy";
import { loadWorkspaceAnalytics, benchmarkComparison } from "@/lib/workspace-analytics";
import { growthIndex } from "@/domain/portfolio-analytics";
import { PerformanceChart } from "@/components/PerformanceChart";

function strategyCardState(strategy:any){
  const status=String(strategy.status);
  if(status==="CLOSED")return {className:"attention",label:"Closed history"};
  if(status==="PAUSED")return {className:"attention",label:"Paused"};
  return strategy.health_status==="HEALTHY"
    ?{className:"healthy",label:"On track"}
    :{className:"attention",label:"Needs attention"};
}

function money(value:number,currency:string){
  return new Intl.NumberFormat("en-GB",{style:"currency",currency,maximumFractionDigits:0}).format(value);
}

export default async function OverviewPage(){
  const user=await requirePageUser();
  const strategies=await listUserStrategies(user.id);
  const actions=await sql.unsafe("SELECT a.id,a.strategy_instance_id,a.action_type,a.title,a.instruction,a.due_at,a.confidence,i.name AS instance_name,acc.name AS account_name,acc.wrapper AS account_wrapper FROM actions a JOIN strategy_instances i ON i.id=a.strategy_instance_id LEFT JOIN accounts acc ON acc.id=a.account_id WHERE i.user_id=$1 AND i.status='ACTIVE' AND a.status IN ('CALCULATED','NOTIFIED','ACKNOWLEDGED') AND a.action_type<>'NO_ACTION' ORDER BY COALESCE(a.due_at,a.created_at),a.created_at LIMIT 12",[user.id]);
  for(const action of actions){
    if(!(await isStoredActionCurrent(String(action.strategy_instance_id),String(action.id))))
      Object.assign(action,STALE_ACTION_DISPLAY);
  }
  const values=await sql.unsafe("SELECT ps.strategy_instance_id,ps.value,a.currency FROM performance_series ps JOIN strategy_instances i ON i.id=ps.strategy_instance_id JOIN accounts a ON a.id=i.account_id WHERE i.user_id=$1 AND i.status<>'CLOSED' AND ps.series_type='USER_VALUE' AND ps.date=(SELECT max(p2.date) FROM performance_series p2 WHERE p2.strategy_instance_id=ps.strategy_instance_id AND p2.series_type='USER_VALUE')",[user.id]);
  const contributions=await sql.unsafe("SELECT l.currency,COALESCE(sum(l.cash_amount),0) AS total FROM ledger_events l JOIN strategy_instances i ON i.id=l.strategy_instance_id WHERE i.user_id=$1 AND i.status<>'CLOSED' AND l.event_type='CONTRIBUTION' AND NOT EXISTS (SELECT 1 FROM ledger_events c WHERE c.correction_of_event_id=l.id) GROUP BY l.currency ORDER BY l.currency",[user.id]);
  const reviewRows=await sql.unsafe("SELECT i.id,i.name,x.due_at FROM strategy_instances i LEFT JOIN LATERAL (SELECT a.due_at FROM actions a WHERE a.strategy_instance_id=i.id AND a.due_at IS NOT NULL ORDER BY a.created_at DESC LIMIT 1) x ON true WHERE i.user_id=$1 AND i.status='ACTIVE'",[user.id]);
  const activeStrategies=strategies.filter((s:any)=>s.status==="ACTIVE");
  const trackedStrategies=strategies.filter((s:any)=>s.status!=="CLOSED");
  const valuedIds=new Set(values.map((row:any)=>String(row.strategy_instance_id)));
  const portfolioFullyValued=trackedStrategies.length>0&&trackedStrategies.every((strategy:any)=>valuedIds.has(String(strategy.id)));
  const totalsByCurrency=new Map<string,number>();
  for(const row of values){
    const currency=String(row.currency);
    totalsByCurrency.set(currency,(totalsByCurrency.get(currency)??0)+Number(row.value));
  }
  const portfolioCurrencyEntries=[...totalsByCurrency.entries()];
  const portfolioHeadline=!portfolioFullyValued
    ?"—"
    :portfolioCurrencyEntries.length===1
      ?money(portfolioCurrencyEntries[0][1],portfolioCurrencyEntries[0][0])
      :"Multi-currency";
  const portfolioValueContext=!portfolioFullyValued
    ?(values.length?values.length+" of "+trackedStrategies.length+" strategies currently valued":"Waiting for current valuations")
    :portfolioCurrencyEntries.length>1
      ?portfolioCurrencyEntries.map(([currency,value])=>money(value,currency)).join(" · ")
      :null;
  const contributionContext=contributions.length
    ?contributions.map((row:any)=>money(Number(row.total),String(row.currency))).join(" · ")
    :"No contributions recorded";
  const primaryAction:any=actions[0];
  const primaryReason=primaryAction?plainEnglishActionReason({actionType:primaryAction.action_type,instruction:primaryAction.instruction}):null;
  const plannedContributions=activeStrategies
    .map((s:any)=>({strategy:s,plan:s.contribution_plan as Record<string,unknown>|null}))
    .filter(({plan})=>plan?.enabled===true&&plan.nextDate)
    .sort((a,b)=>String(a.plan?.nextDate).localeCompare(String(b.plan?.nextDate)));
  const nextContribution=plannedContributions[0];
  const nextReview=reviewRows.filter((row:any)=>row.due_at).sort((a:any,b:any)=>new Date(a.due_at).getTime()-new Date(b.due_at).getTime())[0];
  const healthyCount=activeStrategies.filter((strategy:any)=>strategy.health_status==="HEALTHY").length;
  const analytics=await loadWorkspaceAnalytics(user.id);
  const combined=analytics.aggregate;
  const combinedSummary=analytics.summary;
  const indexedCombined=combined?growthIndex(combined.valuations,combined.flows):[];
  const benchmark=combined?benchmarkComparison(combined.valuations,combined.flows,combined.currency,analytics.benchmarks):null;
  const byDate=new Map<string,{date:string;actual?:number;benchmarkValues?:Record<string,number>}>();
  for(const point of indexedCombined)byDate.set(point.date,{date:point.date,actual:Number(point.value)});
  const extraComparisons:Array<{key:string;label:string;defaultVisible:boolean}>=[];
  if(combined&&indexedCombined.length>1){
    const selectedDates=new Set(combined.valuations.map(p=>p.date));
    for(const strategy of analytics.strategies){
      const graph=growthIndex(strategy.valuations.filter(p=>selectedDates.has(p.date)),strategy.flows);
      if(graph.length!==combined.valuations.length)continue;
      const key="strategy-"+strategy.id;
      extraComparisons.push({key,label:strategy.name,defaultVisible:false});
      for(const point of graph){const entry=byDate.get(point.date)!;entry.benchmarkValues={...entry.benchmarkValues,[key]:Number(point.value)};}
    }
  }
  for(const [date,values] of benchmark?.mapped??[]){
    const current=byDate.get(date);
    if(current)current.benchmarkValues={...current.benchmarkValues,...values};
  }
  const overallChart=[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));
  const overallComparisons=[...(benchmark?.comparisons??[]),...extraComparisons];
  const profitText=combinedSummary&&combined?money(Number(combinedSummary.profitSinceStart),combined.currency):"—";
  const formatPct=(value:number|null|undefined)=>value==null?"—":new Intl.NumberFormat("en-GB",{style:"percent",maximumFractionDigits:2}).format(value/100);

  if(!strategies.length){
    return <section className="glass welcome-state">
      <div className="welcome-orb"><Sparkles size={28}/></div>
      <div className="eyebrow">Welcome</div>
      <h1>Start with one simple decision.</h1>
      <p>Choose a strategy, tell us whether you are starting fresh or already following it, and we will guide you from there.</p>
      <Link className="button primary hero-cta" href="/app/strategies/new"><Plus size={17}/>Start my first strategy</Link>
      <div className="trust-line"><CheckCircle2 size={15}/>No trading is performed automatically. You stay in control of every action.</div>
    </section>;
  }

  return <>
    <div className="dashboard-heading">
      <div>
        <div className="eyebrow">Home</div>
        <h1>{primaryAction?"One thing needs your attention.":"Everything is on track."}</h1>
        <p>{primaryAction?"Your most important next step is ready below.":"There is nothing you need to do right now."}</p>
      </div>
      <Link className="button" href="/app/strategies">View portfolio</Link>
    </div>

    <section className="glass dashboard-hero">
      <div className="portfolio-snapshot">
        <span className="soft-label">Tracked portfolio</span>
        <strong className="portfolio-value">{portfolioHeadline}</strong>
        <div className="portfolio-context">
          <span>{activeStrategies.length} active {activeStrategies.length===1?"strategy":"strategies"}</span>
          <span className="dot-separator">•</span>
          <span>{portfolioValueContext??contributionContext}</span>
        </div>
        {portfolioValueContext&&portfolioFullyValued&&<div className="portfolio-context secondary-context"><span>{contributionContext} contributed</span></div>}
      </div>

      <div className={"today-card "+(primaryAction?"needs-action":"all-clear")}>
        <div className="today-topline">
          <span className="soft-label">Today</span>
          {primaryAction?<span className={"pill "+(primaryAction.confidence==="HIGH"?"good":"warn")}>{primaryAction.confidence} confidence</span>:<CheckCircle2 size={20}/>}
        </div>
        {primaryAction?<>
          <span className="today-strategy">{primaryAction.instance_name}</span>
          <h2>{primaryAction.title}</h2>
          <p>{primaryAction.instruction}</p>
          {primaryAction.account_name&&<div className="action-account-hint"><span>Use <strong>{primaryAction.account_name}</strong>{primaryAction.account_wrapper?" · "+primaryAction.account_wrapper:""}</span></div>}
          {primaryReason&&<div className="plain-reason"><Sparkles size={14}/><span>{primaryReason}</span></div>}
          <Link className="button primary" href={"/app/strategies/"+primaryAction.strategy_instance_id}>Show me what to do <ArrowRight size={16}/></Link>
        </>:<>
          <h2>Nothing to do.</h2>
          <p>We will surface the next action here when your strategy needs you.</p>
        </>}
      </div>
    </section>

    <section className="glass workspace-analytics" aria-label="Combined strategy analytics">
      <div className="section-head">
        <div><div className="eyebrow">Combined performance</div><h2>All your strategies, one view</h2>
          <p>Compare your active and paused strategies on the same dates. Deposits and withdrawals are not counted as gains.</p></div>
      </div>
      <div className="analytics-stats">
        <div className="kpi"><span>Profit since first tracked value</span><strong>{profitText}</strong></div>
        <div className="kpi"><span>Flow-adjusted return (estimate)</span><strong>{formatPct(combinedSummary?.flowAdjustedReturnPct)}</strong></div>
        <div className="kpi"><span>Observed maximum drawdown</span><strong>{formatPct(combinedSummary?.observedMaxDrawdownPct)}</strong></div>
        <div className="kpi"><span>Last observed session P/L</span><strong>{combinedSummary?.lastObservedSessionPnl!=null&&combined?money(Number(combinedSummary.lastObservedSessionPnl),combined.currency):"—"}</strong></div>
      </div>
      {overallChart.length>=2?<div className="chart-card">
        <PerformanceChart data={overallChart} comparisons={overallComparisons} actualLabel="All strategies" indexed fullControls/>
        {benchmark?.missing.length?<p className="help comparison-warning">Unavailable benchmarks: {benchmark.missing.join(", ")}. Comparisons require independently verified total-return data in the portfolio currency, including historical FX where needed.</p>:null}
        <p className="help">Each line starts at 100 on the common tracking dates. Returns are estimated from recorded account snapshots; actual intraday drawdowns may differ.</p>
      </div>:<p className="help">The combined comparison needs at least two dates with complete valuations for every active strategy in the same currency. Nothing is estimated across missing dates or currencies.</p>}
      <div className="section-head"><div><h3>Strategy leaderboard</h3><p>Ranked by estimated flow-adjusted return over identical observed dates, not raw account size.</p></div></div>
      {analytics.leaderboard.length>1?<div className="leaderboard">
        {analytics.leaderboard.map((entry,index)=><Link key={entry.id} href={"/app/strategies/"+entry.id} className="leaderboard-row">
          <span className="leaderboard-rank">{index+1}</span><strong>{entry.name}</strong>
          <span>{formatPct(entry.summary?.flowAdjustedReturnPct)}</span><ArrowRight size={16}/></Link>)}
      </div>:<p className="help">Add a second strategy with overlapping valued history to see a fair ranking.</p>}
      {combinedSummary&&<p className="help">Observed best session: {formatPct(combinedSummary.bestObservedSessionPct)} · Worst session: {formatPct(combinedSummary.worstObservedSessionPct)} · Current observed drawdown: {formatPct(combinedSummary.currentDrawdownPct)}. Missing trading days cannot be reconstructed.</p>}
    </section>

    <div className="quick-strip">
      <div><span>Strategy health</span><strong>{activeStrategies.length?healthyCount+" of "+activeStrategies.length+" on track":"—"}</strong></div>
      <div><span>Next review</span><strong>{nextReview?new Date(nextReview.due_at).toLocaleDateString("en-GB",{day:"numeric",month:"short"}):"When needed"}</strong></div>
      <div><span>Next contribution</span><strong>{nextContribution?money(Number(nextContribution.plan?.amount??0),String(nextContribution.strategy.currency))+" · "+new Date(String(nextContribution.plan?.nextDate)+"T00:00:00Z").toLocaleDateString("en-GB",{day:"numeric",month:"short"}):"Flexible"}</strong></div>
    </div>

    <section className="home-section">
      <div className="section-head">
        <div><div className="eyebrow">Your portfolio</div><h2>Strategies</h2><p>Open one only when you want more detail.</p></div>
        <Link className="text-link" href="/app/strategies/new">Add another <ArrowRight size={14}/></Link>
      </div>
      <div className="strategy-grid">
        {trackedStrategies.map((s:any)=>{const cardState=strategyCardState(s);return <Link href={"/app/strategies/"+s.id} className="card strategy-card premium-card" key={s.id}>
          <div className="strategy-card-top"><span className={"status-light "+cardState.className}/><span>{cardState.label}</span></div>
          <h3>{s.name}</h3>
          <p>{s.strategy_name} · {s.wrapper}</p>
          <div className="strategy-meta"><span className="pill">v{s.version}</span><span className="pill">{s.currency}</span></div>
          <span className="card-arrow"><ArrowRight size={17}/></span>
        </Link>})}
      </div>
    </section>

    {actions.length>1&&<details className="glass secondary-actions">
      <summary>{actions.length-1} more {actions.length-1===1?"action":"actions"} waiting</summary>
      <div className="secondary-actions-list">{actions.slice(1).map((a:any)=><Link className="secondary-action-row" href={"/app/strategies/"+a.strategy_instance_id} key={a.id}><div><strong>{a.instance_name}</strong><span>{a.title}</span></div><ArrowRight size={16}/></Link>)}</div>
    </details>}
  </>;
}
