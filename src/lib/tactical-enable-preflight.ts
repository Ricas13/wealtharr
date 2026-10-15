import "server-only";
import Decimal from "decimal.js";
import type {Sql} from "postgres";
import {assessStrategyMarket,type MarketChoice,type VerifiedCandidate} from "@/domain/strategy/market-eligibility";
import {calculateTacticalAllocation,type TacticalVariant} from "@/domain/strategy/tactical-allocation";
import {loadTacticalCertifiedHistory} from "@/lib/tactical-history-loader";

const variants=new Set<TacticalVariant>([
 "TREND_200_DAILY","GEM_CLASSIC","IVY_GTAA5","PAA_12_A2",
 "VAA_G4","VAA_G12","RISK_PARITY_ERC_252"
]);
/** Admin Studio activation gate.
 * It requires at least one entire *approved* market/wrapper/broker implementation
 * with certified histories for every offensive AND defensive sleeve and a valid
 * current end-of-month signal; human attestations cannot substitute for evidence.
 */
export async function hasExecutableTacticalMarket(args:{
 config:Record<string,unknown>;candidates:readonly VerifiedCandidate[];
 at:Date;db:Pick<Sql,"unsafe">;
}):Promise<boolean>{
 const {config,candidates,at,db}=args,variant=config.variant;
 if(typeof variant!=="string"||!variants.has(variant as TacticalVariant)||
    !Array.isArray(config.riskAssets)||!Array.isArray(config.defensiveAssets)||
    config.riskAssets.some(x=>typeof x!=="string")||config.defensiveAssets.some(x=>typeof x!=="string")||
    !Number.isFinite(at.getTime()))return false;
 const risk=config.riskAssets as string[],def=config.defensiveAssets as string[];
 const universe=[...new Set([...risk,...def])];
 if(universe.length<2)return false;
 const reviewMonth=new Date(Date.UTC(at.getUTCFullYear(),at.getUTCMonth()-1,1)).toISOString().slice(0,7);
 const markets=new Map<string,MarketChoice>();
 for(const candidate of candidates){
  const choice={country:candidate.country,wrapper:candidate.wrapper,
    currency:candidate.tradingLineCurrency,broker:candidate.broker};
  markets.set([choice.country,choice.wrapper,choice.currency,choice.broker??""].join("|"),choice);
 }
 for(const choice of markets.values()){
  if(!/^[A-Za-z]{3}$/.test(choice.currency))continue;
  const assessment=assessStrategyMarket("TACTICAL_ALLOCATION",config,[...candidates],choice,at.toISOString().slice(0,10));
  if(!assessment.available||assessment.positions.length!==universe.length)continue;
  const mapped=assessment.positions.map(p=>({exposure:p.economicExposure,tradingLineId:p.tradingLineId}));
  try{
   const history=await loadTacticalCertifiedHistory(universe,choice.currency,reviewMonth,mapped,at,db);
   if(history.length!==universe.length)continue;
   const weights=calculateTacticalAllocation({
    variant:variant as TacticalVariant,currency:choice.currency,reviewMonth,asOf:at,
    riskAssets:risk,defensiveAssets:def,history,
    calendarCertified:true,totalReturnCertified:true
   });
   if(weights.length&&weights.every(w=>new Decimal(w.weight).isFinite()&&new Decimal(w.weight).gte(0))&&
     weights.reduce((sum,w)=>sum.plus(w.weight),new Decimal(0)).minus(1).abs().lte("0.000000000001"))
     return true;
  }catch{
   // A malformed, stale, ambiguous or unusable source disqualifies this market.
   // Continue only to another wholly verified market, never construct prices.
  }
 }
 return false;
}
