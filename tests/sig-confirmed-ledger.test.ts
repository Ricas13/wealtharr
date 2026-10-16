import {describe,expect,it} from "vitest";
import Decimal from "decimal.js";
import {sigReviewTradesBySleeve} from "../src/domain/strategy/sig-confirmed-ledger";
const at=new Date("2026-10-01T16:00:00Z");
const row:{id:string;correctionOfEventId:string|null;eventType:string;currency:string;cashAmount:string;feeAmount:string;occurredAt:Date;exposure:string|null}={id:"e1",correctionOfEventId:null,eventType:"BUY",currency:"GBP",
 cashAmount:"-1000",feeAmount:"1",occurredAt:new Date("2026-10-02T10:00:00Z"),exposure:"STOCK"};
const sleeves=(rows:typeof row[])=>sigReviewTradesBySleeve(rows,at,"GBP","STOCK","SAFE");
describe("confirmed quarterly Sig ledger",()=>{
 it("tracks partial actual buys and fees rather than proposed orders (spec Example A)",()=>{
   const t=sleeves([row]);
   expect(t.stockBuyGross.toFixed()).toBe("1000");
   // Opening reserve = current reserve 1108.40 + the 1000 bought + the 1 fee = 2109.40;
   // 90% of it is 1898.46, of which 1000 is used: 898.46 left.
   const opening=new Decimal("1108.40").plus(t.stockBuyGross).minus(t.stockSellGross).plus(t.feeTotal);
   expect(opening.toFixed()).toBe("2109.4");
   expect(opening.mul("0.9").minus(t.stockBuyGross).toFixed()).toBe("898.46");
 });
 it("excludes corrected transactions",()=>{
   const t=sleeves([row,{...row,id:"e2",eventType:"CORRECTION",correctionOfEventId:"e1",cashAmount:"1000",feeAmount:"0"}]);
   expect(t.stockBuyGross.toFixed()).toBe("0");
 });
 it("rejects foreign currency in the same funded review",()=>{
   expect(()=>sleeves([{...row,currency:"USD"}])).toThrow("SIG_EXECUTION_CURRENCY_MISMATCH");
 });
});
