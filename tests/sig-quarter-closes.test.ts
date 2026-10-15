import {describe,expect,it} from "vitest";
import Decimal from "decimal.js";
import {verifiedSigQuarterCloses} from "../src/domain/strategy/sig-quarter-closes";
const dates=Array.from({length:9},(_,i)=>new Date(Date.UTC(2024,i*3,1)).toISOString().slice(0,10));
const series={exposure:"NASDAQ_100_3X_LONG",currency:"USD",source:"licensed",
  points:dates.flatMap((date,i)=>[
    {at:new Date(date+"T00:00:00Z"),adjustedClose:new Decimal(String(100+i))},
    {at:new Date(new Date(date+"T00:00:00Z").getTime()+86400000),adjustedClose:new Decimal("1")}
  ])};
describe("9Sig verified review-date snapshots",()=>{
  it("reads specified quarterly snapshots rather than arbitrary final nine daily observations",()=>{
    expect(verifiedSigQuarterCloses(series,dates,"USD").map(n=>n.toString()))
      .toEqual(dates.map((_,i)=>String(100+i)));
  });
  it("blocks missed, duplicate, nonchronological, and wrong currency data",()=>{
    expect(()=>verifiedSigQuarterCloses(series,dates.slice(1),"USD")).toThrow("SIG_NINE");
    expect(()=>verifiedSigQuarterCloses(series,[...dates.slice(0,8),dates[7]],"USD")).toThrow("SIG_NINE");
    expect(()=>verifiedSigQuarterCloses(series,[...dates.slice(0,7),dates[8],dates[7]],"USD")).toThrow("SIG_REVIEW_DATES_OUT_OF_ORDER");
    expect(()=>verifiedSigQuarterCloses(series,dates,"GBP")).toThrow("SIG_QUARTER_HISTORY_UNAVAILABLE");
    expect(()=>verifiedSigQuarterCloses(series,[...dates.slice(0,8),"2028-01-01"],"USD")).toThrow("SIG_REVIEW_CLOSE_UNAVAILABLE");
  });
});
