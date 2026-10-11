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
import {PortfolioAllocationChart} from "@/components/PortfolioAllocationChart";
import {portfolioAllocationBreakdown} from "@/domain/portfolio-allocation-view";

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
  const incomes=await sql.unsafe("SELECT upper(l.currency) AS currency,COALESCE(sum(l.cash_amount),0) AS total FROM ledger_events l JOIN strategy_instances i ON i.id=l.strategy_instance_id WHERE i.user_id=$1 AND i.status<>'CLOSED' AND l.event_type IN ('DIVIDEND','DISTRIBUTION','INTEREST') AND NOT EXISTS (SELECT 1 FROM ledger_events c WHERE c.correction_of_event_id=l.id) GROUP BY upper(l.currency) ORDER BY upper(l.currency)",[user.id]);
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
  const incomeEntries=incomes.filter((r:any)=>/^[A-Z]{3}$/.test(String(r.currency))&&Number.isFinite(Number(r.total)));
  const incomeLabel=incomes.length===0?"—":incomeEntries.length!==incomes.length?"Unavailable":incomes.length===1
    ?money(Number(incomeEntries[0].total),String(incomeEntries[0].currency)):"Multiple currencies";
  const incomeDetail=incomes.length>1&&incomeEntries.length===incomes.length
    ?incomeEntries.map((r:any)=>money(Number(r.total),String(r.currency))).join(" · "):"Recorded dividends, distributions and interest";
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

  const allocation=portfolioAllocationBreakdown(
    trackedStrategies.map((strategy:any)=>({id:String(strategy.id),name:String(strategy.name)})),
    values.map((row:any)=>({strategy_instance_id:String(row.strategy_instance_id),value:row.value,currency:String(row.currency)}))
  );
  const lastKnownValue=new Map(values.map((row:any)=>[String(row.strategy_instance_id),{
    value:Number(row.value),currency:String(row.currency)
  }]));

  if(!strategies.length){
    return <div className="portfolio-dashboard portfolio-empty-dashboard">
      <div className="portfolio-page-heading"><div><div className="eyebrow">DASHBOARD</div><h1>Portfolio overview</h1>
       <p>Your strategies and investments, organised in one place.</p></div></div>
      <section className="portfolio-new-account-state">
       <div className="portfolio-welcome-symbol" aria-hidden="true"><Sparkles size={24}/></div>
       <span className="portfolio-welcome-kicker">WELCOME TO WEALTHARR</span>
       <h2>Start with one simple decision.</h2>
       <p>Add a strategy to begin tracking holdings, real contributions, review dates and performance. We will never invent prices or automatically execute trades.</p><p className="portfolio-onboarding-disclosure">No trading is performed automatically.</p>
       <div className="portfolio-welcome-buttons"><Link className="button primary" href="/app/strategies/new"><Plus size={16}/>Start my first strategy</Link><Link className="button" href="/app/community">Explore strategies</Link></div>
      </section>
      <div className="portfolio-onboarding-grid">
       <div><span>01</span><strong>Choose a strategy</strong><p>Start a new investment plan or import a current position.</p></div>
       <div><span>02</span><strong>Record real values</strong><p>Track holdings, deposits and verified price observations.</p></div>
       <div><span>03</span><strong>Review with confidence</strong><p>Compare results and follow your scheduled rule-based actions.</p></div>
      </div>
    </div>;
  }

  return <div className="portfolio-dashboard">
    <div className="portfolio-page-heading">
      <div><div className="eyebrow">DASHBOARD / ALL STRATEGIES</div><h1>Portfolio overview</h1>
       <p>Account performance and strategy reviews from your recorded investment data.</p></div>
      <div className="portfolio-heading-actions"><Link href="/app/strategies" className="button">View portfolio</Link><Link href="/app/strategies/new" className="button primary"><Plus size={15}/>Add strategy</Link></div>
    </div>

    <section className="portfolio-kpi-grid" aria-label="Portfolio summary">
      <div className="portfolio-kpi-card">
       <span>Tracked portfolio value</span><strong>{portfolioHeadline}</strong>
       <small>{portfolioValueContext??(portfolioFullyValued?"Latest recorded valuation":"Complete valuations required")}</small>
      </div>
      <div className="portfolio-kpi-card">
       <span>Total contributions</span><strong>{contributions.length===1?contributionContext:contributions.length?"Multiple currencies":"—"}</strong>
       <small>{contributions.length!==1?contributionContext:"Recorded cash contributions"}</small>
      </div>
      <div className="portfolio-kpi-card">
       <span>Observed profit</span><strong>{profitText}</strong>
       <small>Since first complete tracked value</small>
      </div>
      <div className="portfolio-kpi-card">
       <span>Flow-adjusted return</span><strong>{formatPct(combinedSummary?.flowAdjustedReturnPct)}</strong>
       <small>Estimate based on dated valuations</small>
      </div>
    </section>

    <div className="portfolio-dashboard-columns">
      <section className="portfolio-panel portfolio-performance-panel" aria-label="Portfolio performance">
       <div className="portfolio-panel-heading"><div><h2>Portfolio performance</h2><p>Tracked growth vs verified benchmark histories</p></div><span className="portfolio-panel-caption">INDEX 100</span></div>
       {overallChart.length>=2?
        <><PerformanceChart data={overallChart} comparisons={overallComparisons} actualLabel="All strategies" indexed fullControls/>
          {benchmark?.missing.length?<p className="help comparison-warning">Unavailable comparisons: {benchmark.missing.join(", ")}.</p>:null}
          <p className="portfolio-chart-footnote">External cash flows are excluded from gains. Date ranges use only observed values and verified comparisons.</p>
        </>:
        <div className="portfolio-chart-empty"><strong>Performance chart awaiting history</strong><p>At least two common dates with complete valued snapshots in one currency are needed. Missing dates and exchange rates are never estimated.</p></div>}
      </section>
      <section className="portfolio-panel portfolio-composition-panel" aria-label="Allocation by strategy">
       <div className="portfolio-panel-heading"><div><h2>Portfolio composition</h2><p>Share of value by tracked strategy</p></div></div>
       <PortfolioAllocationChart allocation={allocation}/>
       <p className="portfolio-chart-footnote">Composition uses the latest recorded value for each open strategy, not intraday prices.</p>
      </section>
    </div>

    <section className={"portfolio-action-summary"+(primaryAction?" has-action":"")}>
     <div className="portfolio-action-status-icon">{primaryAction?<Sparkles size={20}/>:<CheckCircle2 size={20}/>}</div>
     <div className="portfolio-action-summary-copy"><span>{primaryAction?"REVIEW REQUIRED":"STRATEGY MONITORING"}</span>
      <h2>{primaryAction?primaryAction.title:"No pending strategy actions"}</h2>
      <p>{primaryAction?primaryAction.instance_name+" · "+primaryAction.instruction:"Your tracked strategies currently have no outstanding rebalance or execution instructions."}</p>
      {primaryAction?.account_name&&<small>Account: {primaryAction.account_name}{primaryAction.account_wrapper?" · "+primaryAction.account_wrapper:""}</small>}
      {primaryReason&&<small>{primaryReason}</small>}
     </div>
     {primaryAction?<Link href={"/app/strategies/"+primaryAction.strategy_instance_id} className="button primary">Review action <ArrowRight size={15}/></Link>:<Link href="/app/strategies" className="button">View strategies <ArrowRight size={15}/></Link>}
    </section>

    <div className="portfolio-secondary-kpis" aria-label="Tracking details">
     <div><span>Strategy health</span><strong>{activeStrategies.length?healthyCount+" / "+activeStrategies.length+" on track":"No active strategies"}</strong></div>
     <div><span>Next review</span><strong>{nextReview?new Date(nextReview.due_at).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}):"When scheduled"}</strong></div>
     <div><span>Next contribution</span><strong>{nextContribution?money(Number(nextContribution.plan?.amount??0),String(nextContribution.strategy.currency))+" · "+new Date(String(nextContribution.plan?.nextDate)+"T00:00:00Z").toLocaleDateString("en-GB",{day:"numeric",month:"short"}):"Not scheduled"}</strong></div>
     <div><span>Observed drawdown</span><strong>{formatPct(combinedSummary?.observedMaxDrawdownPct)}</strong></div>
    </div>

    <section className="portfolio-panel portfolio-holdings-panel">
      <div className="portfolio-panel-heading"><div><h2>Your strategies</h2><p>Latest snapshots and account status</p></div><Link href="/app/strategies" className="portfolio-panel-link">See all <ArrowRight size={14}/></Link></div>
      <div className="portfolio-table-wrap" role="region" aria-label="Strategy portfolio table" tabIndex={0}>
       <table className="portfolio-data-table"><thead><tr><th scope="col">Strategy</th><th scope="col">Account</th><th scope="col">Last observed value</th><th scope="col">Allocation</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Open strategy</span></th></tr></thead>
       <tbody>{trackedStrategies.map((s:any)=>{
        const health=strategyCardState(s);
        const observed=lastKnownValue.get(String(s.id));
        const proportion=allocation?.items.find(item=>item.id===String(s.id));
        return <tr key={String(s.id)}><td><Link href={"/app/strategies/"+s.id} className="portfolio-row-title">{s.name}</Link><small>{s.strategy_name} · v{s.version}</small></td>
         <td>{s.wrapper}<small>{s.broker_name??String(s.currency)}</small></td>
         <td className="portfolio-cell-numeric">{observed?money(observed.value,observed.currency):"—"}<small>{observed?"Latest record":"Not yet valued"}</small></td>
         <td className="portfolio-cell-numeric">{proportion?proportion.sharePct.toFixed(1)+"%":"—"}</td>
         <td><span className={"portfolio-status "+(health.className==="healthy"?"is-healthy":"is-attention")}>{health.label}</span></td>
         <td><Link href={"/app/strategies/"+s.id} aria-label={"Open "+s.name} className="portfolio-row-arrow"><ArrowRight size={16}/></Link></td></tr>;
       })}</tbody></table>
      </div>
    </section>

    <div className="portfolio-dashboard-bottom">
      <section className="portfolio-panel"><div className="portfolio-panel-heading"><div><h2>Performance details</h2><p>Based on common observed sessions</p></div></div>
       <div className="portfolio-detail-pair"><span>Last observed session P/L</span><strong>{combinedSummary?.lastObservedSessionPnl!=null&&combined?money(Number(combinedSummary.lastObservedSessionPnl),combined.currency):"—"}</strong></div>
       <div className="portfolio-detail-pair"><span>Best observed session</span><strong>{formatPct(combinedSummary?.bestObservedSessionPct)}</strong></div>
       <div className="portfolio-detail-pair"><span>Worst observed session</span><strong>{formatPct(combinedSummary?.worstObservedSessionPct)}</strong></div>
       <div className="portfolio-detail-pair"><span>Current observed drawdown</span><strong>{formatPct(combinedSummary?.currentDrawdownPct)}</strong></div>
       <div className="portfolio-detail-pair"><span>Cash income recorded</span><strong>{incomeLabel}</strong></div>
       <p className="portfolio-chart-footnote">{incomeDetail}. Only income already entered in the strategy ledger is included; no forecast or connected brokerage income is assumed.</p>
      </section>
      <section className="portfolio-panel"><div className="portfolio-panel-heading"><div><h2>Strategy comparison</h2><p>Estimated flow-adjusted performance</p></div></div>
       {analytics.leaderboard.length>1?analytics.leaderboard.slice(0,6).map((entry,index)=><Link className="portfolio-compare-row" href={"/app/strategies/"+entry.id} key={entry.id}>
         <span>{index+1}</span><strong>{entry.name}</strong><b>{formatPct(entry.summary?.flowAdjustedReturnPct)}</b><ArrowRight size={14}/></Link>):
         <p className="portfolio-chart-footnote">Add a second strategy with overlapping valuations to see a fair comparison.</p>}
      </section>
    </div>

    {actions.length>1&&<details className="portfolio-extra-actions">
      <summary>{actions.length-1} more pending {actions.length===2?"action":"actions"}</summary>
      <div>{actions.slice(1).map((a:any)=><Link href={"/app/strategies/"+a.strategy_instance_id} key={String(a.id)}>{a.instance_name} — {a.title} <ArrowRight size={14}/></Link>)}</div>
    </details>}
  </div>;
}
