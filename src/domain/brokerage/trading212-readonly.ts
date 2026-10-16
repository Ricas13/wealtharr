/**
 * Trading 212 read-only transport + strategy-scoped transaction classification.
 * No credentials are persisted here. No orders may ever be placed through this module.
 * See https://docs.trading212.com/api — Invest and Stocks ISA only, beta.
 */
export type Trading212Mode="demo"|"live";
export type Trading212ReadResource="summary"|"positions"|"orders"|"transactions";
const HOSTS:Record<Trading212Mode,string>={
  demo:"https://demo.trading212.com",live:"https://live.trading212.com"
};
const PATHS:Record<Trading212ReadResource,string>={
  summary:"/api/v0/equity/account/summary",
  positions:"/api/v0/equity/positions",
  orders:"/api/v0/equity/history/orders",
  transactions:"/api/v0/equity/history/transactions"
};
export type BrokerPage<T>={items:T[];nextPagePath:string|null};
export function trading212SafeReadUrl(mode:Trading212Mode,resource:Trading212ReadResource,nextPath?:string|null):string{
  const origin=HOSTS[mode],target=nextPath??PATHS[resource];
  // The provider's cursor field is untrusted; reject external hosts, fragments and path changes.
  if(!origin||!PATHS[resource]||!target.startsWith(PATHS[resource]))throw new Error("BROKER_PATH_UNSUPPORTED");
  const url=new URL(target,origin);
  if(url.origin!==origin||url.pathname!==PATHS[resource]||url.hash||url.username||url.password)
    throw new Error("BROKER_PATH_UNSUPPORTED");
  if((resource==="positions"||resource==="summary")&&url.search)throw new Error("BROKER_QUERY_UNSUPPORTED");
  if(resource!=="positions"&&resource!=="summary"){
    for(const key of url.searchParams.keys())
      if(key!=="cursor"&&key!=="limit")throw new Error("BROKER_QUERY_UNSUPPORTED");
    if(url.searchParams.getAll("limit").length>1||url.searchParams.getAll("cursor").length>1)
      throw new Error("BROKER_QUERY_UNSUPPORTED");
    const lim=url.searchParams.get("limit");
    if(lim!==null&&(!/^[0-9]+$/.test(lim)||Number(lim)>50||Number(lim)<1))
      throw new Error("BROKER_QUERY_UNSUPPORTED");
  }
  return url.toString();
}
export async function trading212ReadPage<T>(args:{
  mode:Trading212Mode;resource:Exclude<Trading212ReadResource,"summary">;
  credentials:{key:string;secret:string};nextPagePath?:string|null;
  fetcher?:typeof fetch;
}):Promise<BrokerPage<T>>{
  if(!args.credentials.key||!args.credentials.secret)throw new Error("BROKER_CREDENTIALS_REQUIRED");
  if(/[\r\n]/.test(args.credentials.key+args.credentials.secret))throw new Error("BROKER_CREDENTIALS_INVALID");
  const url=trading212SafeReadUrl(args.mode,args.resource,args.nextPagePath);
  const authorization="Basic "+Buffer.from(args.credentials.key+":"+args.credentials.secret).toString("base64");
  const response=await (args.fetcher??fetch)(url,{
    method:"GET",headers:{authorization,accept:"application/json"},
    cache:"no-store",redirect:"error",signal:AbortSignal.timeout(10000)
  });
  if(!response.ok)throw new Error(response.status===429?"BROKER_RATE_LIMIT":response.status===401||response.status===403?"BROKER_AUTH_FAILED":"BROKER_UNAVAILABLE");
  const body:unknown=await response.json();
  if(args.resource==="positions"){
    if(!Array.isArray(body)||body.length>5000)throw new Error("BROKER_RESPONSE_INVALID");
    return {items:body as T[],nextPagePath:null};
  }
  if(!body||typeof body!=="object"||Array.isArray(body))throw new Error("BROKER_RESPONSE_INVALID");
  const page=body as Record<string,unknown>;
  if(!Array.isArray(page.items)||page.items.length>50||!(page.nextPagePath===null||typeof page.nextPagePath==="string"))
    throw new Error("BROKER_RESPONSE_INVALID");
  if(page.nextPagePath)trading212SafeReadUrl(args.mode,args.resource,page.nextPagePath);
  return {items:page.items as T[],nextPagePath:page.nextPagePath};
}
export async function trading212ReadHistory<T>(args:{
  mode:Trading212Mode;resource:"orders"|"transactions";
  credentials:{key:string;secret:string};fetcher?:typeof fetch;maxPages?:number;
  beforePage?:(pageNumber:number)=>Promise<void>;
}):Promise<T[]>{
  const maxPages=Math.min(Math.max(args.maxPages??10,1),100);
  const result:T[]=[];
  const visited=new Set<string>();
  let next:string|null=PATHS[args.resource]+"?limit=50";
  for(let page=0;page<maxPages&&next;page++){
    if(visited.has(next))throw new Error("BROKER_CURSOR_LOOP");
    // Provider quotas are per BROKERAGE ACCOUNT, not per API key or Wealtharr strategy.
    // Server-owned callers can enforce shared, persistent account-level quotas here.
    await args.beforePage?.(page+1);
    visited.add(next);
    const response:BrokerPage<T>=await trading212ReadPage<T>({...args,nextPagePath:next});
    result.push(...response.items);
    next=response.nextPagePath;
    if(!next)return result;
  }
  throw new Error("BROKER_HISTORY_TRUNCATED");
}
/** Only explicitly assigned stable transaction IDs may leave the selection boundary.
 * Matching by ticker, ISIN, or overall brokerage quantity NEVER assigns a lot.
 */
export function selectConfirmedStrategyLots<T extends {id:string|number}>(rows:readonly T[],assignedIds:ReadonlySet<string>){
  if(assignedIds.size===0)return {matched:[] as T[],missing:[] as string[],ambiguous:false};
  const seen=new Set<string>();
  const matched:T[]=[];
  let ambiguous=false;
  for(const row of rows){
    const id=String(row.id);
    if(!assignedIds.has(id))continue;
    if(seen.has(id)){ambiguous=true;continue;}
    seen.add(id);matched.push(row);
  }
  const missing=[...assignedIds].filter(id=>!seen.has(id));
  return {matched:ambiguous?[]:matched,missing,ambiguous};
}

/** Verify the actual account ID and currency reported by Trading 212. Never trust a
 * manually entered account label as proof that two API keys belong to the same account.
 * Account-wide cash/investments in the provider response are discarded immediately.
 * Rate limit: provider allows only one account-summary request per five seconds.
 */
export async function trading212ReadAccountIdentity(args:{
  mode:Trading212Mode;
  credentials:{key:string;secret:string};
  fetcher?:typeof fetch;
}):Promise<{id:string;currency:string}>{
  if(!args.credentials.key||!args.credentials.secret)throw new Error("BROKER_CREDENTIALS_REQUIRED");
  if(/[\r\n]/.test(args.credentials.key+args.credentials.secret))throw new Error("BROKER_CREDENTIALS_INVALID");
  const url=trading212SafeReadUrl(args.mode,"summary");
  const authorization="Basic "+Buffer.from(args.credentials.key+":"+args.credentials.secret).toString("base64");
  const response=await (args.fetcher??fetch)(url,{
    method:"GET",headers:{authorization,accept:"application/json"},
    cache:"no-store",redirect:"error",signal:AbortSignal.timeout(10_000)
  });
  if(!response.ok)throw new Error(response.status===429?"BROKER_RATE_LIMIT":response.status===401||response.status===403?"BROKER_AUTH_FAILED":"BROKER_UNAVAILABLE");
  const raw:unknown=await response.json();
  if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new Error("BROKER_ACCOUNT_ID_INVALID");
  const obj=raw as Record<string,unknown>;
  const id=String(obj.id??"");
  const currency=String(obj.currency??"").toUpperCase();
  if(!/^[0-9]{1,20}$/.test(id)||!/^[A-Z]{3}$/.test(currency))
    throw new Error("BROKER_ACCOUNT_ID_INVALID");
  return {id,currency};
}
