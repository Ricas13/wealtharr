import Decimal from "decimal.js";

export type StrategyAlertInput={
  actionType:string;amount:string|null;currency:string|null;
  ticker:string|null;calculatedAt:Date;brand:string;
};
export function buildStrategyAlert(input:StrategyAlertInput){
  const {actionType,amount,currency,ticker,calculatedAt,brand}=input;
  let title="Strategy review ready";
  let guidance="Your scheduled strategy review needs attention.";
  if(actionType==="DATA_REQUIRED"){
    title="Strategy data needs attention";
    guidance="Some holdings or market data need verification before a safe trade can be calculated.";
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
