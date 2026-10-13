import {describe,expect,it} from "vitest";
import {parseTrading212Csv} from "@/domain/brokerage/trading212-csv";

describe("Trading 212 local-only transaction preview",()=>{
 const header="Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Exchange rate,Total (GBP),ID";
 it("keeps buy/sell rows with stable IDs while discarding other brokerage activity",()=>{
   const csv=header+"\n"+
     "Market buy,2026-01-05 10:00:00,US0378331005,AAPL,Apple Inc,2,123.45,USD,0.77,190.00,lot-a\n"+
     "Dividend (Ordinary),2026-01-07 10:00:00,US0378331005,AAPL,Apple Inc,,,USD,,5,div-1\n"+
     "Limit sell,2026-01-08 10:00:00,IE0000000001,ETF,ETF,1,100,GBP,,100,lot-b\n";
   const got=parseTrading212Csv(csv);
   expect(got.map(x=>({id:x.id,side:x.side,ticker:x.ticker}))).toEqual([
     {id:"lot-a",side:"BUY",ticker:"AAPL"},{id:"lot-b",side:"SELL",ticker:"ETF"}
   ]);
   expect(JSON.stringify(got)).not.toContain("div-1");
 });
 it("supports reordered optional currency columns, BOM, CSV quotes and embedded commas",()=>{
   const csv="\uFEFFTicker,Action,ID,No. of shares,Time,Name,ISIN,Price / share\r\n"+
     'ETF,Market buy,x01,1,2026-01-01 11:00:00,"Issuer, Fund",IE0000000001,12.30\r\n';
   const got=parseTrading212Csv(csv);
   expect(got).toHaveLength(1);
   expect(got[0].currency).toBe("");
 });
 it("refuses ambiguous duplicate IDs and incomplete values before showing trades",()=>{
   const row="Market buy,2026-01-01 10:00:00,US0378331005,AAPL,Apple Inc,1,1,USD,1,1,id";
   expect(()=>parseTrading212Csv(header+"\n"+row+"\n"+row)).toThrow("BROKER_CSV_DUPLICATE_ID");
   expect(()=>parseTrading212Csv(header+"\n"+row.replace(",1,1,USD",",,1,USD"))).toThrow("BROKER_CSV_AMBIGUOUS_TRADE");
   expect(()=>parseTrading212Csv("Action,Time\nMarket buy,2026")).toThrow("BROKER_CSV_UNSUPPORTED_HEADERS");
 });
 it("rejects impossible dates, nonsensical currency and malformed ISIN before trade preview",()=>{
   const row="Market buy,2026-01-05 10:00:00,US0378331005,AAPL,Apple Inc,2,123.45,USD,0.77,190.00,lot-a";
   expect(()=>parseTrading212Csv(header+"\n"+row.replace("2026-01-05","2026-02-30"))).toThrow("BROKER_CSV_AMBIGUOUS_TRADE");
   expect(()=>parseTrading212Csv(header+"\n"+row.replace("10:00:00","25:00:00"))).toThrow("BROKER_CSV_AMBIGUOUS_TRADE");
   expect(()=>parseTrading212Csv(header+"\n"+row.replace("US0378331005","NOT-AN-ISIN"))).toThrow("BROKER_CSV_AMBIGUOUS_TRADE");
   expect(()=>parseTrading212Csv(header+"\n"+row.replace(",USD,0.77",",US D,0.77"))).toThrow("BROKER_CSV_AMBIGUOUS_TRADE");
   expect(parseTrading212Csv(header+"\n"+row.replace("2026-01-05","2024-02-29"))).toHaveLength(1);
 });
 it("does not accept malformed quoting or a browser-killing oversize statement",()=>{
   expect(()=>parseTrading212Csv(header+'\n"Market buy,2026')).toThrow("BROKER_CSV_UNCLOSED_QUOTE");
   expect(()=>parseTrading212Csv("x".repeat(2_500_001))).toThrow("BROKER_CSV_TOO_LARGE");
 });
});
