import {describe,it,expect} from "vitest";
import {switchPositionDiscrepancies} from "@/domain/strategy/switch-position-eligibility";
const needed=[
 {economicExposure:"BROAD_EQUITY",leverage:"1",direction:"LONG" as const},
 {economicExposure:"AGGREGATE_BONDS",leverage:"1",direction:"LONG" as const}
];
const assets=[
 {id:"stocks",exposure:"BROAD_EQUITY",leverage:"1.000000",direction:"LONG"},
 {id:"bonds",exposure:"AGGREGATE_BONDS",leverage:"1",direction:"LONG"},
 {id:"nasdaq3",exposure:"NASDAQ_100_3X_LONG",leverage:"3",direction:"LONG"},
 {id:"short",exposure:"BROAD_EQUITY",leverage:"1",direction:"SHORT"}
];
describe("destination strategy must recognise transferred holdings before switch",()=>{
 it("accepts existing eligible equity and bond sleeves with different target weights",()=>{
  expect(switchPositionDiscrepancies([{instrumentId:"stocks",quantity:"12.5"},{instrumentId:"bonds",quantity:"3"}],assets,needed)).toEqual([]);
 });
 it("refuses a leveraged 9Sig position when switching to a normal 60/40 portfolio",()=>{
  expect(switchPositionDiscrepancies([{instrumentId:"nasdaq3",quantity:"10"}],assets,needed)).toEqual(["nasdaq3"]);
 });
 it("rejects shorts, unknown assets, absent metadata and malformed positions",()=>{
  expect(switchPositionDiscrepancies([
   {instrumentId:"short",quantity:"4"},{instrumentId:"unknown",quantity:"2"},
   {instrumentId:"stocks",quantity:"-5"},{instrumentId:"bonds",quantity:"oops"}
  ],assets,needed)).toEqual(["short","unknown","stocks","bonds"]);
 });
 it("ignores zero closed-out positions",()=>{
  expect(switchPositionDiscrepancies([{instrumentId:"unknown",quantity:"0"}],assets,needed)).toEqual([]);
 });
});
