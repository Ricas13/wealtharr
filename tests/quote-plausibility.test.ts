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
 // Reference accepted on 10-09 (before the effective date 10-12); the quote arrives on 10-12.
 const pre={price:"100",observedAt:new Date("2026-10-09T16:00:00Z")};
 const quoteAt=new Date("2026-10-12T10:00:00Z");
 const action=(effectiveDate:string,to=2,from=1,id="a1")=>({id,to,from,effectiveDate});
 const cand=(a:ReturnType<typeof action>,preReference:{price:string;observedAt:Date}|null=pre,postEffectivePrices:string[]=[],alreadyExplained=false)=>({action:a,preReference,postEffectivePrices,alreadyExplained});
 it("explains the halved price of a 2:1 split effective on the quote date, with a pre-effective reference",()=>{
  const a=action("2026-10-12");
  expect(explainingCorporateAction("50",quoteAt,[cand(a)])).toBe(a);
  expect(assessQuote(50,pre,quoteAt)).toEqual({ok:false,code:"IMPLAUSIBLE_MOVE"});
 });
 it("requires the reference to be observed on a UTC date strictly before the effective date",()=>{
  const sameDay={price:"100",observedAt:new Date("2026-10-12T00:30:00Z")};
  expect(explainingCorporateAction("50",quoteAt,[cand(action("2026-10-12"),sameDay)])).toBeNull();
  expect(explainingCorporateAction("50",quoteAt,[cand(action("2026-10-12"),null)])).toBeNull();
  const lastSecond={price:"100",observedAt:new Date("2026-10-11T23:59:59Z")};
  expect(explainingCorporateAction("50",quoteAt,[cand(action("2026-10-12"),lastSecond)])).not.toBeNull();
 });
 it("requires the effective date not to be after the quote date and the quote within 14 days",()=>{
  expect(explainingCorporateAction("50",quoteAt,[cand(action("2026-10-13"))])).toBeNull();
  const early={price:"100",observedAt:new Date("2026-10-11T12:00:00Z")};
  expect(explainingCorporateAction("50",new Date("2026-10-26T10:00:00Z"),[cand(action("2026-10-12"),early)])).not.toBeNull();
  expect(explainingCorporateAction("50",new Date("2026-10-27T10:00:00Z"),[cand(action("2026-10-12"),early)])).toBeNull();
 });
 it("accepts a lagging provider: 100 stamped on the effective day does not become the reference",()=>{
  // 100 was accepted on 10-12 (latest on/after the effective date); the pre-effective reference is still 100.
  expect(explainingCorporateAction("50",quoteAt,[cand(action("2026-10-12"),pre,["100"])])).not.toBeNull();
 });
 it("never applies an action twice once the post-split price has been adopted",()=>{
  // Accepted 50 on/after the effective date; 25 is not within 5% of 100 x 1 / 2 either.
  expect(explainingCorporateAction("25",new Date("2026-10-13T10:00:00Z"),[cand(action("2026-10-12"),pre,["50"])])).toBeNull();
  // And a quote that would match is not "explained" again: the post-split price is already adopted.
  expect(explainingCorporateAction("50",new Date("2026-10-13T10:00:00Z"),[cand(action("2026-10-12"),pre,["50"])])).toBeNull();
 });
 it("does not re-explain a 50 print after the price drifted 100 -> 50 -> 30",()=>{
  // The 50 was already adopted (an accepted observation matches the band) even though the latest is 30.
  const later=new Date("2026-10-14T10:00:00Z");
  expect(explainingCorporateAction("50",later,[cand(action("2026-10-12"),pre,["30","50"])])).toBeNull();
  // Or the action has already explained an observation of this line.
  expect(explainingCorporateAction("50",later,[cand(action("2026-10-12"),pre,["30"],true)])).toBeNull();
  // Without either, the same print is explained.
  expect(explainingCorporateAction("50",later,[cand(action("2026-10-12"),pre,["30"])])).not.toBeNull();
 });
 it("does not explain an unrelated move, a x100 pence/pounds error or a stub price",()=>{
  expect(explainingCorporateAction("50",quoteAt,[])).toBeNull();
  expect(explainingCorporateAction("50",quoteAt,[cand(action("2026-10-12",3,1))])).toBeNull();
  expect(explainingCorporateAction("60",quoteAt,[cand(action("2026-10-12"))])).toBeNull();
  expect(explainingCorporateAction("10000",quoteAt,[cand(action("2026-10-12"))])).toBeNull();
  expect(explainingCorporateAction("0.0123",quoteAt,[cand(action("2026-10-12",1000,1))])).toBeNull();
 });
 it("explains a 1:10 reverse split and applies the 5% tolerance",()=>{
  expect(explainingCorporateAction("1000",quoteAt,[cand(action("2026-10-12",1,10))])).not.toBeNull();
  expect(explainingCorporateAction("52.45",quoteAt,[cand(action("2026-10-12"))])).not.toBeNull();
  expect(explainingCorporateAction("52.55",quoteAt,[cand(action("2026-10-12"))])).toBeNull();
 });
 it("prefers the latest matching effective date and ignores malformed actions",()=>{
  const older=action("2026-10-10",2,1,"older");
  const newer=action("2026-10-12",2,1,"newer");
  expect(explainingCorporateAction("50",quoteAt,[cand(older),cand(newer)])).toBe(newer);
  expect(explainingCorporateAction("50",quoteAt,[cand({id:"x",to:2,from:1,effectiveDate:"nope"}),cand({id:"y",to:0,from:1,effectiveDate:"2026-10-12"})])).toBeNull();
 });
});
