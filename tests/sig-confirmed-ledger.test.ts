import {describe,expect,it} from "vitest";
import Decimal from "decimal.js";
import {confirmedSigReviewTrades} from "../src/domain/strategy/sig-confirmed-ledger";
const at=new Date("2026-10-01T16:00:00Z");
const row={id:"e1",correctionOfEventId:null,eventType:"BUY",currency:"GBP",
 cashAmount:"-1000",feeAmount:"1",occurredAt:new Date("2026-10-02T10:00:00Z")};
describe("confirmed quarterly Sig ledger",()=>{
 it("tracks partial actual buys and fees rather than proposed orders",()=>{
   const t=confirmedSigReviewTrades([row],at,"GBP",new Decimal("1108.40"));
   expect(t.buyGross.toFixed()).toBe("1000");
   expect(t.reserveBeforeTrades.toFixed()).toBe("2109.4");
   expect(t.reserveBeforeTrades.mul("0.9").minus(t.buyGross).toFixed()).toBe("898.46");
 });
 it("excludes corrected transactions",()=>{
   const t=confirmedSigReviewTrades([row,{...row,id:"e2",eventType:"CORRECTION",
     correctionOfEventId:"e1",cashAmount:"1000",feeAmount:"-1"}],
     at,"GBP",new Decimal("2109.40"));
   expect(t.buyGross.toFixed()).toBe("0");
 });
 it("rejects foreign currency in the same funded review",()=>{
   expect(()=>confirmedSigReviewTrades([{...row,currency:"USD"}],at,"GBP",new Decimal(1000)))
     .toThrow("SIG_EXECUTION_CURRENCY_MISMATCH");
 });
});
