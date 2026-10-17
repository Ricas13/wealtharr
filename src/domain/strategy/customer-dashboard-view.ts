/**
 * Presentation-only strategy dashboard contract.
 * A strategy's engine, confirmed valuation and latest executable action remain
 * authoritative. The dashboard never derives a trade from an ETF ticker or
 * guesses live weights/signals from a strategy definition.
 */
export type StrategyDashboardStatus="ON_TRACK"|"ACTION_REQUIRED"|"AWAITING_CONFIRMATION"|"DATA_NEEDED"|"PAUSED"|"CLOSED";

export type StrategyDashboardInput={
  status:string;
  healthStatus:string;
  actionType?:string|null;
  actionStatus?:string|null;
  actionStale?:boolean;
};

export type StrategyDashboardView={
  status:StrategyDashboardStatus;
  label:string;
  headline:string;
  description:string;
  tone:"good"|"attention"|"muted";
  priority:number;
};

export function strategyDashboardView(input:StrategyDashboardInput):StrategyDashboardView{
  if(input.status==="CLOSED")return {status:"CLOSED",label:"Closed",headline:"Strategy closed",description:"Your recorded history is available to review.",tone:"muted",priority:5};
  if(input.status==="PAUSED")return {status:"PAUSED",label:"Paused",headline:"Strategy paused",description:"Resume to calculate new actions.",tone:"muted",priority:4};
  if(input.actionStale||input.actionType==="DATA_REQUIRED"||
    (!input.actionType&&input.healthStatus!=="HEALTHY"))
    return {status:"DATA_NEEDED",label:"Data needed",headline:"Check your strategy data",description:"Review holdings, prices and reconciliation before relying on a new signal.",tone:"attention",priority:0};
  if(input.actionType==="HOLD")
    return {status:"AWAITING_CONFIRMATION",label:"Awaiting confirmation",headline:"Confirm this review",description:"Check the calculations before marking this review complete.",tone:"attention",priority:1};
  if(["BUY","SELL","REBALANCE"].includes(input.actionType??""))
    return {status:"ACTION_REQUIRED",label:"Action required",headline:"A strategy action is ready",description:"Review the proposed action, market data and execution requirements.",tone:"attention",priority:1};
  if(input.healthStatus!=="HEALTHY")
    return {status:"DATA_NEEDED",label:"Data needed",headline:"Check your strategy data",description:"Review account data before relying on the current calculation.",tone:"attention",priority:0};
  return {status:"ON_TRACK",label:"On track",headline:"Nothing to do right now",description:"No outstanding action. Your existing strategy rules continue to apply.",tone:"good",priority:3};
}

export type StrategyDashboardContext={
  label:string;
  detail:string;
  kind:"target"|"allocation"|"momentum"|"tactical"|"hybrid"|"other";
};

/** Human-readable, configuration-derived context; never asserts current holdings or signal values. */
export function strategyDashboardContext(engine:string,config:Record<string,unknown>):StrategyDashboardContext{
  if(engine==="QUARTERLY_SIGNAL_TARGET")
    return {kind:"target",label:"Quarterly target",detail:"Target line and protection rules · Optional VIX tools only on supported versions"};
  if(engine==="VALUE_TARGET")
    return {kind:"target",label:"Value target",detail:"Growth target, contribution impact and the next review"};
  if(engine==="FIXED_ALLOCATION"){
    const allocations=Array.isArray(config.allocations)?config.allocations:[];
    const weights=allocations.flatMap(row=>{
      if(!row||typeof row!=="object")return [];
      const x=row as Record<string,unknown>;
      const weight=Number(x.weight);
      return typeof x.exposure==="string"&&Number.isFinite(weight)&&weight>=0&&weight<=1
        ?[(weight*100).toFixed(0)+"% "+x.exposure.replaceAll("_"," ").toLowerCase()]:[];
    });
    return {kind:"allocation",label:"Fixed allocation",detail:weights.length? "Target weights: "+weights.slice(0,3).join(" · ")+(weights.length>3?" · +"+(weights.length-3)+" more"):"Target allocation and next rebalance"};
  }
  if(engine==="TACTICAL_ALLOCATION")
    return {kind:"momentum",label:"Rules-based selection",detail:"Latest verified momentum signals, selected exposure and defensive option"};
  if(engine==="TRINITY_HYBRID")
    return {kind:"hybrid",label:"Hybrid strategy",detail:"Static sleeve, tactical selection and review rules"};
  if(engine==="TWO_FUNDS_MODERATE")
    return {kind:"allocation",label:"Two-fund allocation",detail:"Age-based target weights and your next rebalance"};
  return {kind:"other",label:"Strategy tracking",detail:"Portfolio history, next action and your versioned rules"};
}
