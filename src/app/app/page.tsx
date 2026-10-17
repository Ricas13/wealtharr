import { EXECUTABLE_ACTION_STATUS_SQL } from "@/domain/actions";
import Link from "next/link";
import { ArrowRight, CalendarDays, CheckCircle2, Clock3, Layers3, Plus, Sparkles, Wallet } from "lucide-react";
import { requirePageUser } from "@/lib/session";
import { listUserStrategies } from "@/lib/strategy-service";
import { sql } from "@/lib/db";
import {isStoredActionCurrent,STALE_ACTION_DISPLAY} from "@/lib/action-service";
import { plainEnglishActionReason } from "@/domain/action-copy";
import { loadWorkspaceAnalytics, benchmarkComparison } from "@/lib/workspace-analytics";
import { growthIndex,summarizeObservedPerformance } from "@/domain/portfolio-analytics";
import { PerformanceChart } from "@/components/PerformanceChart";
import { money as formatMoney, pct } from "@/lib/format";
import {strategyDashboardView,strategyDashboardContext} from "@/domain/strategy/customer-dashboard-view";

function money(value:number,currency:string){
  return formatMoney(value,currency,{dp:0});
}

export default async function OverviewPage(){
  const user=await requirePageUser();
  const strategies=await listUserStrategies(user.id);
  const actions=await sql.unsafe("SELECT a.id,a.strategy_instance_id,a.action_type,a.title,a.instruction,a.due_at,a.confidence,i.name AS instance_name,acc.name AS account_name,acc.wrapper AS account_wrapper FROM actions a JOIN strategy_instances i ON i.id=a.strategy_instance_id LEFT JOIN accounts acc ON acc.id=a.account_id WHERE i.user_id=$1 AND i.status='ACTIVE' AND a.status IN ("+EXECUTABLE_ACTION_STATUS_SQL+") AND a.action_type<>'NO_ACTION' ORDER BY COALESCE(a.due_at,a.created_at),a.created_at LIMIT 12",[user.id]);
  for(const action of actions){
    if(!(await isStoredActionCurrent(String(action.strategy_instance_id),String(action.id))))
      Object.assign(action,STALE_ACTION_DISPLAY);
  }
  // Fetch the most recent current action for EVERY strategy, not just the
  // first twelve in the global queue. Never label a stale or unhealthy instance
  // as "on track" merely because it was omitted from that queue.
  const actionByInstanceRows=await sql.unsafe(
    "SELECT DISTINCT ON (a.strategy_instance_id) a.strategy_instance_id,a.id,a.action_type,a.status "+
    "FROM actions a JOIN strategy_instances i ON i.id=a.strategy_instance_id "+
    "WHERE i.user_id=$1 AND i.status='ACTIVE' AND a.status IN ("+EXECUTABLE_ACTION_STATUS_SQL+") "+
    "ORDER BY a.strategy_instance_id,a.created_at DESC,a.id DESC",[user.id]);
  const currentActionById=new Map<string,{type:string;status:string;stale:boolean}>();
  for(const item of actionByInstanceRows){
    currentActionById.set(String(item.strategy_instance_id),{
      type:String(item.action_type),status:String(item.status),
      stale:!(await isStoredActionCurrent(String(item.strategy_instance_id),String(item.id)))
    });
  }
  const configRows=await sql.unsafe(
    "SELECT i.id,v.engine_key,v.config FROM strategy_instances i "+
    "JOIN strategy_versions v ON v.id=i.strategy_version_id WHERE i.user_id=$1",[user.id]);
  const configById=new Map(configRows.map(row=>[String(row.id),{
    engine:String(row.engine_key),config:(row.config??{}) as Record<string,unknown>
  }]));
  const viewsById=new Map(strategies.map(strategy=>{
    const action=currentActionById.get(String(strategy.id));
    return [String(strategy.id),strategyDashboardView({
      status:String(strategy.status),healthStatus:String(strategy.health_status),
      actionType:action?.type,actionStatus:action?.status,actionStale:action?.stale
    })] as const;
  }));
  const orderedStrategies=[...strategies].filter(strategy=>strategy.status!=="CLOSED")
    .sort((a,b)=>(viewsById.get(String(a.id))?.priority??9)-(viewsById.get(String(b.id))?.priority??9));
  const dataNeededCount=orderedStrategies.filter(strategy=>
    viewsById.get(String(strategy.id))?.status==="DATA_NEEDED").length;
  const values=await sql.unsafe("SELECT ps.strategy_instance_id,ps.value,a.currency FROM performance_series ps JOIN strategy_instances i ON i.id=ps.strategy_instance_id JOIN accounts a ON a.id=i.account_id WHERE i.user_id=$1 AND i.status<>'CLOSED' AND ps.series_type='USER_VALUE' AND ps.date=(SELECT max(p2.date) FROM performance_series p2 WHERE p2.strategy_instance_id=ps.strategy_instance_id AND p2.series_type='USER_VALUE')",[user.id]);
  const contributions=await sql.unsafe("SELECT l.currency,COALESCE(sum(l.cash_amount),0) AS total FROM ledger_events l JOIN strategy_instances i ON i.id=l.strategy_instance_id WHERE i.user_id=$1 AND i.status<>'CLOSED' AND l.event_type='CONTRIBUTION' AND NOT EXISTS (SELECT 1 FROM ledger_events c WHERE c.correction_of_event_id=l.id) GROUP BY l.currency ORDER BY l.currency",[user.id]);
  const reviewRows=await sql.unsafe("SELECT i.id,i.name,x.due_at FROM strategy_instances i LEFT JOIN LATERAL (SELECT a.due_at FROM actions a WHERE a.strategy_instance_id=i.id AND a.due_at >= NOW() ORDER BY a.due_at ASC LIMIT 1) x ON true WHERE i.user_id=$1 AND i.status='ACTIVE'",[user.id]);
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
  const primaryAction:any=actions.find((a:any)=>a.action_type==="DATA_REQUIRED")??actions[0];
  const dueHeading=actions.length===0?(dataNeededCount?"Data needs attention":"No actions due"):
    actions.length>=12?"12+ actions due":actions.length===1?"1 action due":actions.length+" actions due";
  const primaryReason=primaryAction?plainEnglishActionReason({actionType:primaryAction.action_type,instruction:primaryAction.instruction}):null;
  const plannedContributions=activeStrategies
    .map((s:any)=>({strategy:s,plan:s.contribution_plan as Record<string,unknown>|null}))
    .filter(({plan})=>plan?.enabled===true&&plan.nextDate)
    .sort((a,b)=>String(a.plan?.nextDate).localeCompare(String(b.plan?.nextDate)));
  const nextContribution=plannedContributions[0];
  const nextReview=reviewRows.filter((row:any)=>row.due_at).sort((a:any,b:any)=>new Date(a.due_at).getTime()-new Date(b.due_at).getTime())[0];
  const onTrackCount=activeStrategies.filter((strategy:any)=>viewsById.get(String(strategy.id))?.status==="ON_TRACK").length;
  const analytics=await loadWorkspaceAnalytics(user.id);
  const returnsById=new Map(analytics.strategies.map(entry=>[
    entry.id,summarizeObservedPerformance(entry.valuations,entry.flows)
  ] as const));
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
  const profitText=combinedSummary&&combined?formatMoney(Number(combinedSummary.profitSinceStart),combined.currency,{signed:true}):"—";
  const formatPct=(value:number|null|undefined)=>value==null?"—":pct(value,{dp:2,signed:true});


  if(!strategies.length){
    return <div className="home-dashboard member-dashboard">
      <section className="glass welcome-state member-welcome">
        <div className="welcome-orb"><Sparkles size={28}/></div>
        <div className="eyebrow">Welcome</div>
        <h1>Start with one simple decision.</h1>
        <p>Choose a strategy, tell us whether you are starting fresh or already following it, and we will guide you from there.</p>
        <Link className="button primary hero-cta" href="/app/strategies/new"><Plus size={17}/>Start my first strategy</Link>
        <div className="trust-line"><CheckCircle2 size={15}/>No trading is performed automatically. You stay in control of every action.</div>
      </section>
    </div>;
  }

  return <div className="home-dashboard member-dashboard">
    <header className="member-heading">
      <div>
        <div className="eyebrow">Your investment workspace</div>
        <h1>My dashboard</h1>
        <p>One clear view of your strategies, your portfolio and what needs attention.</p>
      </div>
      <div className="member-next-review">
        <span>Next scheduled review</span>
        <strong>{nextReview?new Date(nextReview.due_at).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}):"Not scheduled"}</strong>
      </div>
    </header>

    <section className={"member-action-hero "+(primaryAction||dataNeededCount?"requires-review":"is-clear")+(dataNeededCount||primaryAction?.action_type==="DATA_REQUIRED"?" has-data-issue":"")} id="action-queue" aria-labelledby="member-action-title">
      <div className="member-action-copy">
        <span className="member-action-kicker"><span aria-hidden="true" className="member-action-dot"/>{primaryAction?dueHeading:"No action due"}</span>
        <h2 id="member-action-title">{primaryAction?primaryAction.title:dataNeededCount?"Some strategies need a check.":"You're all caught up."}</h2>
        <p>{primaryAction?primaryAction.instruction:dataNeededCount?"There are no pending trade actions, but "+dataNeededCount+" strategy "+(dataNeededCount===1?"needs":"need")+" a data or reconciliation review.":"No outstanding actions. Your strategies will highlight the next verified decision when it is due."}</p>
        {primaryAction&&primaryAction.account_name&&<p className="member-action-account">Account: <strong>{primaryAction.account_name}</strong>{primaryAction.account_wrapper?" · "+primaryAction.account_wrapper:""}</p>}
        {primaryReason&&<p className="member-action-reason"><Sparkles size={14}/>{primaryReason}</p>}
        <div className="member-action-buttons">
          <Link className="button primary" href={primaryAction?"/app/strategies/"+primaryAction.strategy_instance_id:"/app/strategies"}>
            {primaryAction?"Review next step":"View your strategies"} <ArrowRight size={17}/>
          </Link>
          {primaryAction&&<span>{primaryAction.instance_name} · {primaryAction.confidence==="HIGH"?"High confidence":"Check the supporting data"}</span>}
        </div>
        <p className="member-trust"><CheckCircle2 size={15}/> For research purposes only. <strong>You decide whether to trade.</strong></p>
      </div>
      <div className="member-action-visual" aria-hidden="true">
        <div className="member-orbit"><div className="member-orbit-inner"><svg viewBox="0 0 100 70" fill="none" role="presentation"><path d="M7 51 L27 34 L42 41 L63 16 L78 26 L94 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><circle cx="94" cy="8" r="4" fill="currentColor"/><circle cx="7" cy="51" r="3" fill="currentColor"/><path d="M16 13C28 4 48 6 55 17" stroke="currentColor" strokeDasharray="2 5" opacity=".6"/></svg><span>Rules over reactions</span></div></div>
      </div>
    </section>

    <section className="member-metrics" aria-label="Portfolio at a glance">
      <div className="member-metric">
        <div className="member-metric-top"><span>Total tracked value</span><Wallet size={16}/></div>
        <strong>{portfolioHeadline}</strong>
        <small>{portfolioValueContext??(portfolioCurrencyEntries.length?"Across tracked strategies":"Awaiting verified valuations")}</small>
      </div>
      <div className="member-metric">
        <div className="member-metric-top"><span>Strategy health</span><CheckCircle2 size={16}/></div>
        <strong>{activeStrategies.length?onTrackCount+" of "+activeStrategies.length:"—"}</strong>
        <small>No outstanding action or data blocker</small>
      </div>
      <div className="member-metric">
        <div className="member-metric-top"><span>Strategies following</span><Layers3 size={16}/></div>
        <strong>{activeStrategies.length}</strong>
        <small>{trackedStrategies.length-activeStrategies.length} paused · {actions.length>=12?"12+ actions listed":actions.length+" actions due"}</small>
      </div>
      <div className="member-metric">
        <div className="member-metric-top"><span>Next contribution</span><Plus size={16}/></div>
        <strong>{nextContribution?money(Number(nextContribution.plan?.amount??0),String(nextContribution.strategy.currency)):"—"}</strong>
        <small>{nextContribution?new Date(String(nextContribution.plan?.nextDate)+"T00:00:00Z").toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})+" · "+nextContribution.strategy.name:"No contribution scheduled"}</small>
      </div>
    </section>

    <section className="member-strategies" aria-labelledby="member-strategies-title">
      <div className="member-section-heading"><div><div className="eyebrow">Established frameworks</div><h2 id="member-strategies-title">Your strategies</h2><p>Each follows its own rules, schedule and recorded holdings.</p></div><Link className="text-link" href="/app/strategies">View all <ArrowRight size={15}/></Link></div>
      <div className="strategy-grid adaptive-strategy-grid">
        {orderedStrategies.map((strategy:any)=>{
          const view=viewsById.get(String(strategy.id))!;
          const config=configById.get(String(strategy.id));
          const context=strategyDashboardContext(config?.engine??"",config?.config??{});
          const latest=values.find((row:any)=>String(row.strategy_instance_id)===String(strategy.id));
          return <Link href={"/app/strategies/"+strategy.id} className="card strategy-card premium-card adaptive-strategy-card" key={strategy.id}
            aria-label={strategy.name+" — "+view.label}>
            <div className="strategy-card-top"><span className={"status-light "+(view.tone==="good"?"healthy":"attention")}/><span className={"adaptive-state "+view.tone}>{view.label}</span></div>
            <h3>{strategy.name}</h3>
            <p className="adaptive-strategy-type">{strategy.strategy_name} · {context.label}</p>
            <div className="adaptive-strategy-value"><span>Last recorded value</span><strong>{latest?money(Number(latest.value),String(strategy.currency)):"Not yet valued"}</strong></div>
            <div className="adaptive-strategy-return">
              <span>Flow-adjusted return (estimate)</span>
              <strong>{returnsById.get(String(strategy.id))?.flowAdjustedReturnPct!=null
                ?formatPct(returnsById.get(String(strategy.id))?.flowAdjustedReturnPct)
                :"Not enough history"}</strong>
            </div>
            <div className="adaptive-strategy-next"><strong>{view.headline}</strong><span>{view.description}</span></div>
            <p className="adaptive-strategy-rule">{context.detail}</p>
            <div className="strategy-meta"><span className="pill">v{strategy.version}</span><span className="pill">{strategy.wrapper}</span></div>
            <span className="card-arrow"><ArrowRight size={17}/></span>
          </Link>;
        })}
        <Link href="/app/strategies/new" className="member-add-strategy"><Plus size={18}/><strong>Follow another strategy</strong><span>Browse available approaches</span></Link>
      </div>
    </section>

    <div className="member-focus-grid">
      <section className="glass member-journey" aria-labelledby="member-journey-title">
        <div className="member-panel-heading">
          <div><h2 id="member-journey-title">Portfolio journey</h2><p>Flow-adjusted indexed performance, not cash contributions</p></div>
        </div>
        {overallChart.length>=2?<div className="member-journey-chart">
          <PerformanceChart data={overallChart} comparisons={overallComparisons} actualLabel="All strategies" indexed fullControls/>
          {benchmark?.missing.length?<p className="help comparison-warning">Unavailable benchmarks: {benchmark.missing.join(", ")}. Comparisons require independently verified total-return data in the portfolio currency, including historical FX where needed.</p>:null}
          <p className="help">Each line starts at 100 on matching observed dates. Estimated from recorded account snapshots; unobserved trading days and intraday drawdowns are not reconstructed.</p>
        </div>:<div className="member-chart-empty"><strong>Performance history is building.</strong><p>We need at least two dates with complete same-currency valuations to draw a fair combined chart. Missing values are never fabricated.</p></div>}
      </section>
      <section className="glass member-coming-up" aria-labelledby="member-coming-up-title">
        <div className="member-panel-heading">
          <div><h2 id="member-coming-up-title">Coming up</h2><p>Your schedule, not market noise</p></div>
          <Clock3 size={17}/>
        </div>
        <div className="member-upcoming-item">
          <div className="member-upcoming-icon"><Plus size={17}/></div>
          <div><strong>Planned contribution</strong><p>{nextContribution?nextContribution.strategy.name:"Nothing scheduled yet"}</p><span>{nextContribution?money(Number(nextContribution.plan?.amount??0),String(nextContribution.strategy.currency))+" · "+new Date(String(nextContribution.plan?.nextDate)+"T00:00:00Z").toLocaleDateString("en-GB",{day:"numeric",month:"short"}):"Set a schedule in a strategy"}</span></div>
        </div>
        <div className="member-upcoming-item">
          <div className="member-upcoming-icon secondary"><CalendarDays size={17}/></div>
          <div><strong>Next scheduled review</strong><p>{nextReview?nextReview.name:"No future review scheduled"}</p><span>{nextReview?new Date(nextReview.due_at).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}):"We will highlight actions when they are available"}</span></div>
        </div>
        <div className="member-upcoming-footer"><Link href="/app/notifications">View notifications <ArrowRight size={15}/></Link></div>
      </section>
    </div>

    {actions.length>1&&<section className="glass member-queue-list" aria-label="Other actions due">
      <div className="member-panel-heading"><div><h2>Also needs review</h2><p>{actions.length-1} additional {actions.length===2?"action":"actions"} in your queue</p></div></div>
      {actions.slice(1).map((a:any)=><Link className="member-queue-row" href={"/app/strategies/"+a.strategy_instance_id} key={a.id}>
        <div><strong>{a.title}</strong><span>{a.instance_name}</span></div><ArrowRight size={16}/>
      </Link>)}
      {actions.length===12&&<p className="help">Showing the first 12 actions. Open individual strategies to review additional pending items.</p>}
    </section>}

    <details className="glass member-deep-dive" id="performance-details">
      <summary><span><strong>Performance details &amp; methodology</strong><small>See contributions, estimated returns, drawdowns and the fair-comparison leaderboard.</small></span><ArrowRight size={18}/></summary>
      <div className="member-deep-dive-body">
        <div className="analytics-stats">
          <div className="kpi"><span>Profit since first tracked value</span><strong className={combinedSummary?(Number(combinedSummary.profitSinceStart)>=0?"portfolio-positive":"portfolio-negative"):undefined}>{profitText}</strong></div>
          <div className="kpi"><span>Flow-adjusted return (estimate)</span><strong className={combinedSummary?.flowAdjustedReturnPct!=null?(Number(combinedSummary.flowAdjustedReturnPct)>=0?"portfolio-positive":"portfolio-negative"):undefined}>{formatPct(combinedSummary?.flowAdjustedReturnPct)}</strong></div>
          <div className="kpi"><span>Observed maximum drawdown</span><strong className={combinedSummary?.observedMaxDrawdownPct!=null?"portfolio-negative":undefined}>{formatPct(combinedSummary?.observedMaxDrawdownPct)}</strong></div>
          <div className="kpi"><span>Last observed session P/L</span><strong className={combinedSummary?.lastObservedSessionPnl!=null?(Number(combinedSummary.lastObservedSessionPnl)>=0?"portfolio-positive":"portfolio-negative"):undefined}>{combinedSummary?.lastObservedSessionPnl!=null&&combined?formatMoney(Number(combinedSummary.lastObservedSessionPnl),combined.currency,{signed:true}):"—"}</strong></div>
        </div>
        <div className="member-panel-heading"><div><h3>Strategy leaderboard</h3><p>Ranked by estimated flow-adjusted return over identical observed dates, not account size.</p></div></div>
        {analytics.leaderboard.length>1?<div className="leaderboard">{analytics.leaderboard.map((entry,index)=><Link key={entry.id} href={"/app/strategies/"+entry.id} className="leaderboard-row"><span className="leaderboard-rank">{index+1}</span><strong>{entry.name}</strong><span>{formatPct(entry.summary?.flowAdjustedReturnPct)}</span><ArrowRight size={16}/></Link>)}</div>:<p className="help">Add a second strategy with overlapping valued history to see a fair ranking.</p>}
        {combinedSummary&&<p className="help">Observed best session: {formatPct(combinedSummary.bestObservedSessionPct)} · Worst session: {formatPct(combinedSummary.worstObservedSessionPct)} · Current observed drawdown: {formatPct(combinedSummary.currentDrawdownPct)}. Missing trading days cannot be reconstructed.</p>}
        <p className="help">Total contributions recorded: {contributionContext}. Figures reflect verified recorded holdings and prices, not brokerage balances or hypothetical future returns.</p>
      </div>
    </details>
  </div>;
}
