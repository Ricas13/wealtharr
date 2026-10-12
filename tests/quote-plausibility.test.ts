import {describe,expect,it} from "vitest";
import {assessQuote,matchesRecordedSplit} from "@/domain/quote-plausibility";

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
});
