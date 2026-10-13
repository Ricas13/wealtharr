import {describe,expect,it,vi} from "vitest";
import {selectConfirmedStrategyLots,trading212ReadHistory,trading212ReadPage,trading212SafeReadUrl} from "@/domain/brokerage/trading212-readonly";

describe("Trading212 read-only transport boundary",()=>{
 it("only allows documented GET data endpoints on fixed provider hosts",()=>{
   expect(trading212SafeReadUrl("demo","positions")).toBe("https://demo.trading212.com/api/v0/equity/positions");
   expect(trading212SafeReadUrl("live","orders","/api/v0/equity/history/orders?limit=50&cursor=123")).toContain("cursor=123");
   for(const path of [
     "https://evil.example/api/v0/equity/history/orders",
     "/api/v0/equity/history/orders/../order",
     "/api/v0/equity/history/orders?limit=100",
     "/api/v0/equity/history/orders?limit=50&redirect=evil",
     "/api/v0/equity/history/orders#secret",
     "/api/v0/equity/history/orders?cursor=1&cursor=2"
   ])expect(()=>trading212SafeReadUrl("live","orders",path)).toThrow(/UNSUPPORTED/);
   expect(()=>trading212SafeReadUrl("live","positions","/api/v0/equity/orders/market")).toThrow();
 });
 it("issues GET requests only; blocks redirects; never attempts order POST",async()=>{
   const fetcher=vi.fn(async(url:RequestInfo|URL,options?:RequestInit)=>{
     expect(String(url)).toBe("https://demo.trading212.com/api/v0/equity/positions");
     expect(options?.method).toBe("GET");
     expect(options?.redirect).toBe("error");
     expect(String((options?.headers as Record<string,string>)?.authorization)).toMatch(/^Basic /);
     return {ok:true,json:async()=>[{id:12,ticker:"AAPL_US_EQ"}]} as Response;
   }) as unknown as typeof fetch;
   const p=await trading212ReadPage({mode:"demo",resource:"positions",credentials:{key:"x",secret:"y"},fetcher});
   expect(p.items).toEqual([{id:12,ticker:"AAPL_US_EQ"}]);
   expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it("refuses cursor loops and incomplete paginations, rather than omitting unreviewed lots",async()=>{
   const fetcher=vi.fn(async()=>({ok:true,json:async()=>({items:[{id:1}],nextPagePath:"/api/v0/equity/history/orders?limit=50"})})) as unknown as typeof fetch;
   await expect(trading212ReadHistory({mode:"demo",resource:"orders",credentials:{key:"a",secret:"b"},fetcher})).rejects.toThrow("BROKER_CURSOR_LOOP");
   const page=vi.fn(async()=>({ok:true,json:async()=>({items:[{id:1}],nextPagePath:"/api/v0/equity/history/orders?limit=50&cursor=2"})})) as unknown as typeof fetch;
   await expect(trading212ReadHistory({mode:"demo",resource:"orders",credentials:{key:"a",secret:"b"},fetcher:page,maxPages:1})).rejects.toThrow("BROKER_HISTORY_TRUNCATED");
 });
 it("enforces response-size limits and authentication errors",async()=>{
   const invalid=vi.fn(async()=>({ok:true,json:async()=>({items:[{id:1}],nextPagePath:"https://evil.com/"})})) as unknown as typeof fetch;
   await expect(trading212ReadPage({mode:"demo",resource:"orders",credentials:{key:"a",secret:"b"},fetcher:invalid})).rejects.toThrow("BROKER_PATH_UNSUPPORTED");
   const denied=vi.fn(async()=>({ok:false,status:401})) as unknown as typeof fetch;
   await expect(trading212ReadPage({mode:"live",resource:"positions",credentials:{key:"a",secret:"b"},fetcher:denied})).rejects.toThrow("BROKER_AUTH_FAILED");
 });
});

describe("strategy-lot assignment isolation",()=>{
 const rows=[{id:101,ticker:"ETF",quantity:12},{id:102,ticker:"ETF",quantity:4},{id:103,ticker:"OTHER",quantity:20}];
 it("does not assign a single position by ticker, instrument, or portfolio total",()=>{
   expect(selectConfirmedStrategyLots(rows,new Set()).matched).toHaveLength(0);
   const onlyStrategy=selectConfirmedStrategyLots(rows,new Set(["102"]));
   expect(onlyStrategy.matched).toEqual([rows[1]]);
   expect(onlyStrategy.missing).toEqual([]);
 });
 it("requires confirmation for missing and duplicated external trade IDs",()=>{
   expect(selectConfirmedStrategyLots(rows,new Set(["999"])).missing).toEqual(["999"]);
   const duplicate=selectConfirmedStrategyLots([...rows,rows[1]],new Set(["102"]));
   expect(duplicate.ambiguous).toBe(true);
   expect(duplicate.matched).toEqual([]);
 });
});
