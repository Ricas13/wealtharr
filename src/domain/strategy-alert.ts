import Decimal from "decimal.js";

export type StrategyAlertInput={
  actionType:string;amount:string|null;currency:string|null;
  ticker:string|null;calculatedAt:Date;brand:string;
  /** Outcome code of a DATA_REQUIRED from the execution convention (see outcomeReasonCode). */
  reason?:string|null;
};

const PREFERENCE_WORDS:Record<string,string>={
  SELLING_DISABLED:"selling is disabled",
  CASH_BUFFER:"your cash buffer",
  MINIMUM_TRADE:"your minimum trade size"
};

/**
 * Specific, amount-free title and guidance for a DATA_REQUIRED outcome of the execution convention.
 * Returns null for an unknown or missing code (the generic data text is used).
 */
export function dataRequiredAlertText(reason:string|null|undefined):{title:string;guidance:string}|null{
  if(!reason)return null;
  if(reason==="CASH_SHORTFALL")return {title:"Cash needed to rebalance",guidance:"The next purchase needs more cash than is spendable."};
  if(reason==="TOO_SMALL")return {title:"Portfolio too small for this strategy",guidance:"One unit of a holding costs more than its share of your portfolio, so the rebalance cannot be sized."};
  if(reason==="UNPRICED")return {title:"Price needed before you trade",guidance:"A verified current price is missing for a holding, so the rebalance cannot be sized."};
  if(reason==="NOTHING_TO_SELL")return {title:"Nothing to sell",guidance:"The strategy wants to reduce a holding that your execution account does not hold."};
  if(reason.startsWith("PREFERENCE_BLOCKED:")){
    const named=reason.slice("PREFERENCE_BLOCKED:".length).split(",").map((code)=>PREFERENCE_WORDS[code]).filter((word):word is string=>Boolean(word));
    return {
      title:"A trade preference blocks the rebalance",
      guidance:"A trade preference ("+(named.length?named.join(" and "):"see your trade preferences")+") prevents the next order."
    };
  }
  return null;
}

/**
 * Notification class used for the review key. A change of DATA_REQUIRED outcome code is a new key, hence a
 * new notification and delivery; ordinary actions share the REVIEW class.
 */
export function alertKeyClass(actionType:string,reason:string|null|undefined):string{
  if(actionType!=="DATA_REQUIRED")return "REVIEW";
  return reason?"DATA_REQUIRED:"+reason:"DATA_REQUIRED";
}

export function buildStrategyAlert(input:StrategyAlertInput){
  const {actionType,amount,currency,ticker,calculatedAt,brand,reason}=input;
  let title="Strategy review ready";
  let guidance="Your scheduled strategy review needs attention.";
  if(actionType==="DATA_REQUIRED"){
    const specific=dataRequiredAlertText(reason);
    if(specific){
      title=specific.title;
      guidance=specific.guidance;
    }else{
      title="Strategy data needs attention";
      guidance="Some holdings or market data need verification before a safe trade can be calculated.";
    }
  }else if(actionType==="HOLD"){
    guidance="The latest strategy review indicates no buy or sell is currently required.";
  }else if((actionType==="BUY"||actionType==="SELL")&&amount&&currency&&ticker){
    try{
      const value=new Decimal(amount);
      if(value.isFinite()&&value.gt(0)){
        const display=value.toDecimalPlaces(2,Decimal.ROUND_HALF_EVEN).toFixed(2);
        guidance="Indicative "+(actionType==="BUY"?"buy":"sell")+": "+display+" "+currency+" of "+ticker+".";
      }
    }catch{/* Never invent a trade amount from invalid data. */}
  }
  const date=Number.isFinite(calculatedAt.getTime())?calculatedAt.toISOString():"unknown";
  return {
    title,body:guidance+"\nCalculated: "+date+
      "\nOpen "+brand+" for the latest live valuation, verify it against your broker, and confirm the order before trading."+
      "\nMarket prices and instructions may have changed. This alert is not a trade order or personalised recommendation."
  };
}
