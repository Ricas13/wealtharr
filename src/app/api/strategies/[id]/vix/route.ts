import {requireUser} from "@/lib/session";
import {getStrategyForUser} from "@/lib/strategy-service";
import {getMarketDataProvider} from "@/lib/market-data";
import {classifySheet107Vix} from "@/domain/strategy/sig-sheet-107";
import {newYorkDate,newYorkMinutes,isNyseTradingDay} from "@/domain/strategy/sig-nyse-quarters";
import {invalidPathId} from "@/lib/route-params";
import {authFailure} from "@/lib/api-auth";
import {consumeRateLimit} from "@/lib/security";

/**
 * A completed VIX cash-index CLOSE, never an intraday last, a VIX option
 * quote, or a synthetic "fear" trade signal. Live provider setup is explicitly
 * opt-in and requires a rights-cleared HTTP adapter + mapped index symbol.
 */
export async function GET(_request:Request,context:{params:Promise<{id:string}>}){
  const headers={"cache-control":"private, no-store"};
  try{
    const user=await requireUser();
    await consumeRateLimit("sig-vix:"+user.id,20,60);
    const {id}=await context.params;
    const invalid=invalidPathId(id);if(invalid)return invalid;
    const strategy=await getStrategyForUser(user.id,id);
    if(!strategy)return Response.json({error:"Strategy not found."},{status:404,headers});
    const config=(strategy.config??{}) as Record<string,unknown>;
    if(String(strategy.engine)!=="QUARTERLY_SIGNAL_TARGET"||
      config.ruleVersion!=="WEALTHARR_OWNER_2026_V3_SHEET107")
      return Response.json({error:"This version does not include the optional VIX overlay."},{status:409,headers});
    const provider=getMarketDataProvider();
    const symbol=process.env.MARKET_DATA_VIX_SYMBOL??"";
    if(provider.name!=="http"||!provider.configured||!/^[A-Za-z0-9.^_-]{1,24}$/.test(symbol))
      return Response.json({available:false,reason:"A rights-cleared VIX daily-close feed has not been configured."},{headers});

    const now=new Date();
    const bar=await provider.historicalPrice(symbol,now);
    if(!bar||bar.granularity!=="DAILY_BAR"||bar.priceKind!=="CLOSE")
      return Response.json({available:false,reason:"The provider did not confirm a completed VIX daily close."},{headers});
    const date=newYorkDate(bar.observedAt);
    const today=newYorkDate(now);
    if(!isNyseTradingDay(date)||date>today||
      (date===today&&newYorkMinutes(now)<16*60+20)||
      bar.observedAt.getTime()>now.getTime()||
      now.getTime()-bar.observedAt.getTime()>5*86_400_000)
      return Response.json({available:false,reason:"VIX close is unverified, premature or stale."},{headers});
    const regime=classifySheet107Vix(bar.price);
    return Response.json({available:true,value:bar.price,regime,closeDate:date,
      source:bar.provider,note:"Informational VIX close only; optional actions require your explicit decision and broker-confirmed fills."},{headers});
  }catch(error){
    const auth=authFailure(error);if(auth)return auth;
    if(error instanceof Error&&error.message==="RATE_LIMITED")
      return Response.json({error:"Too many VIX checks."},{status:429,headers});
    return Response.json({available:false,reason:"The VIX observation cannot be verified."},{headers});
  }
}
