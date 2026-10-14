import {describe,expect,it} from "vitest";
import {assessQuote,explainingCorporateAction,matchesRecordedSplit} from "@/domain/quote-plausibility";

const now=new Date("2026-10-08T12:00:00Z");
const prev=(price:number,daysAgo=1)=>({price,observedAt:new Date(now.getTime()-daysAgo*86_400_000)});

describe("assessQuote",()=>{
 it("accepts ordinary and large-but-possible moves",()=>{
  expect(assessQuote(101,prev(100),now)).toEqual({ok:true});
  expect(assessQuote(70,prev(100),now)).toEqual({ok:true});
  expect(assessQuote(140,prev(100),now)).toEqual({ok:true});
 });
 it("rejects pence-vs-pounds and dropped-decimal errors",()=>{
  expect(assessQuote(10000,prev(100),now)).toEqual({ok:false,code:"IMPLAUSIBLE_MOVE"});
  expect(assessQuote(1,prev(100),now)).toEqual({ok:false,code:"IMPLAUSIBLE_MOVE"});
 });
 it("rejects non-positive and non-finite prices",()=>{
  for(const bad of [0,-5,NaN,Infinity])expect(assessQuote(bad,null,now)).toEqual({ok:false,code:"NON_POSITIVE_PRICE"});
 });
 it("has nothing to compare against on the first quote or after a long gap",()=>{
  expect(assessQuote(500,null,now)).toEqual({ok:true});
  expect(assessQuote(500,prev(100,30),now)).toEqual({ok:true});
 });
 it("honours a configured limit",()=>{
  expect(assessQuote(130,prev(100),now,0.2)).toEqual({ok:false,code:"IMPLAUSIBLE_MOVE"});
 });
 it("rejects a move of exactly the limit: an exact 2:1 split halves the price",()=>{
  // 50 / 100 - 1 = -0.5 and |-0.5| >= 0.5, so a 2:1 split (or a doubling) is not a believable quote.
  expect(assessQuote(50,prev(100),now)).toEqual({ok:false,code:"IMPLAUSIBLE_MOVE"});
  expect(assessQuote(150,prev(100),now)).toEqual({ok:false,code:"IMPLAUSIBLE_MOVE"});
  expect(assessQuote(200,prev(100),now)).toEqual({ok:false,code:"IMPLAUSIBLE_MOVE"});
  // 3:1 split: 100/3 = 33.33 is a -66.7% move.
  expect(assessQuote("33.3333",prev(100),now)).toEqual({ok:false,code:"IMPLAUSIBLE_MOVE"});
 });
 it("accepts the largest move just inside the limit",()=>{
  // 50.01 / 100 - 1 = -0.4999
  expect(assessQuote("50.01",prev(100),now)).toEqual({ok:true});
  expect(assessQuote("149.99",prev(100),now)).toEqual({ok:true});
 });
 it("keeps an old reference while an earlier bad quote for the line is unresolved",()=>{
  // 30 days old: normally no reference (accepted), but with a recorded rejection it still applies.
  expect(assessQuote(500,prev(100,30),now)).toEqual({ok:true});
  expect(assessQuote(500,prev(100,30),now,0.5,{ignoreReferenceAge:true})).toEqual({ok:false,code:"IMPLAUSIBLE_MOVE"});
  expect(assessQuote(101,prev(100,30),now,0.5,{ignoreReferenceAge:true})).toEqual({ok:true});
 });
 it("compares exactly with decimals rather than binary floating point",()=>{
  // 0.3 / 0.6 is exactly one half; 0.1 + 0.2 style float error must not move the verdict.
  expect(assessQuote("0.3",{price:"0.6",observedAt:prev(0).observedAt},now)).toEqual({ok:false,code:"IMPLAUSIBLE_MOVE"});
 });
});

describe("matchesRecordedSplit",()=>{
 it("matches the price a recorded split explains, within 5%",()=>{
  // 2-for-1 on 100: expected 100 x 1 / 2 = 50. 51 is +2%, 60 is +20%.
  expect(matchesRecordedSplit(50,100,[{to:2,from:1}])).toBe(true);
  expect(matchesRecordedSplit(51,100,[{to:2,from:1}])).toBe(true);
  expect(matchesRecordedSplit(60,100,[{to:2,from:1}])).toBe(false);
  // 1-for-10 reverse on 100: expected 100 x 10 / 1 = 1000.
  expect(matchesRecordedSplit(1000,100,[{to:1,from:10}])).toBe(true);
 });
 it("does not let an unrelated recorded split excuse a different move",()=>{
  // 3-for-1 expects 33.33; a 2:1 move to 50 is +50% from that.
  expect(matchesRecordedSplit(50,100,[{to:3,from:1}])).toBe(false);
  expect(matchesRecordedSplit(50,100,[])).toBe(false);
  expect(matchesRecordedSplit(50,100,[{to:3,from:1},{to:2,from:1}])).toBe(true);
 });
 it("ignores malformed splits and prices",()=>{
  expect(matchesRecordedSplit(50,100,[{to:0,from:1},{to:"x",from:1},{to:2,from:2}])).toBe(false);
  expect(matchesRecordedSplit(0,100,[{to:2,from:1}])).toBe(false);
 });
 it("matches 3:2 and the 5% tolerance edge",()=>{
  // 3-for-2 on 90: expected 90 x 2 / 3 = 60.
  expect(matchesRecordedSplit(60,90,[{to:3,from:2}])).toBe(true);
  // 2:1 on 100 expects 50: 52.45 is +4.9% (match), 52.55 is +5.1% (no); 47.55 is -4.9%, 47.45 is -5.1%.
  expect(matchesRecordedSplit("52.45",100,[{to:2,from:1}])).toBe(true);
  expect(matchesRecordedSplit("52.55",100,[{to:2,from:1}])).toBe(false);
  expect(matchesRecordedSplit("47.55",100,[{to:2,from:1}])).toBe(true);
  expect(matchesRecordedSplit("47.45",100,[{to:2,from:1}])).toBe(false);
 });
});

describe("explainingCorporateAction",()=>{
 const reference={price:"100",observedAt:new Date("2026-10-09T16:00:00Z")};
 const quoteAt=new Date("2026-10-12T10:00:00Z");
 const action=(effectiveDate:string,to=2,from=1,id="a1")=>({id,to,from,effectiveDate});
 it("explains the halved price of a 2:1 split effective after the reference and on/before the quote",()=>{
  const a=action("2026-10-12");
  expect(explainingCorporateAction("50",reference,quoteAt,[a])).toBe(a);
  expect(assessQuote(50,reference,quoteAt)).toEqual({ok:false,code:"IMPLAUSIBLE_MOVE"});
  // Effective the day after the reference is also strictly after it.
  expect(explainingCorporateAction("50",reference,quoteAt,[action("2026-10-10")])).not.toBeNull();
 });
 it("requires the effective date to be strictly after the reference date and not after the quote date",()=>{
  expect(explainingCorporateAction("50",reference,quoteAt,[action("2026-10-09")])).toBeNull();
  expect(explainingCorporateAction("50",reference,quoteAt,[action("2026-10-08")])).toBeNull();
  expect(explainingCorporateAction("50",reference,quoteAt,[action("2026-10-13")])).toBeNull();
 });
 it("limits the quote to 14 days after the effective date",()=>{
  // Effective 10-12: a quote on 10-26 is exactly 14 days after; 10-27 is 15.
  expect(explainingCorporateAction("50",{price:"100",observedAt:new Date("2026-10-11T12:00:00Z")},new Date("2026-10-26T10:00:00Z"),[action("2026-10-12")])).not.toBeNull();
  expect(explainingCorporateAction("50",{price:"100",observedAt:new Date("2026-10-11T12:00:00Z")},new Date("2026-10-27T10:00:00Z"),[action("2026-10-12")])).toBeNull();
 });
 it("never applies an action twice: a post-split reference is not explained again",()=>{
  // 50 accepted on the effective day; a later 25 is -50% again but the reference is already post-split.
  const accepted={price:"50",observedAt:new Date("2026-10-12T11:00:00Z")};
  expect(explainingCorporateAction("25",accepted,new Date("2026-10-13T10:00:00Z"),[action("2026-10-12")])).toBeNull();
 });
 it("does not explain an unrelated move, a x100 pence/pounds error or a stub price",()=>{
  expect(explainingCorporateAction("50",reference,quoteAt,[])).toBeNull();
  expect(explainingCorporateAction("50",reference,quoteAt,[action("2026-10-12",3,1)])).toBeNull();
  expect(explainingCorporateAction("60",reference,quoteAt,[action("2026-10-12")])).toBeNull();
  expect(explainingCorporateAction("10000",reference,quoteAt,[action("2026-10-12")])).toBeNull();
  expect(explainingCorporateAction("0.0123",reference,quoteAt,[action("2026-10-12",1000,1)])).toBeNull();
 });
 it("explains a 1:10 reverse split and applies the 5% tolerance",()=>{
  expect(explainingCorporateAction("1000",reference,quoteAt,[action("2026-10-12",1,10)])).not.toBeNull();
  expect(explainingCorporateAction("52.45",reference,quoteAt,[action("2026-10-12")])).not.toBeNull();
  expect(explainingCorporateAction("52.55",reference,quoteAt,[action("2026-10-12")])).toBeNull();
 });
 it("prefers the latest matching effective date and ignores malformed actions",()=>{
  const older=action("2026-10-10",2,1,"older");
  const newer=action("2026-10-12",2,1,"newer");
  expect(explainingCorporateAction("50",reference,quoteAt,[older,newer])).toBe(newer);
  expect(explainingCorporateAction("50",reference,quoteAt,[{id:"x",to:2,from:1,effectiveDate:"nope"},{id:"y",to:0,from:1,effectiveDate:"2026-10-12"}])).toBeNull();
 });
});
