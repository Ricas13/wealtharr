import {describe,expect,it} from "vitest";
import {moderateTwoFundsWeights} from "../src/domain/strategy/two-funds-age";

describe("Merriman 2FFL Moderate years-to-retirement glide path (research only)",()=>{
  it.each([
    [0,"1.0000","0.0000"],[1,"0.9850","0.0150"],
    [10,"0.8500","0.1500"],[20,"0.7000","0.3000"],
    [30,"0.5500","0.4500"],[40,"0.4000","0.6000"],
    [60,"0.1000","0.9000"],[66,"0.0100","0.9900"],
    [67,"0.0000","1.0000"],[80,"0.0000","1.0000"]
  ])("%i years until retirement splits correctly",(years,targetDateFund,smallCapValue)=>{
    expect(moderateTwoFundsWeights(years)).toEqual({targetDateFund,smallCapValue});
  });
  it.each([-1,101,20.5,NaN,Infinity])("invalid years %s fail closed",(years)=>{
    expect(()=>moderateTwoFundsWeights(years)).toThrow("TWO_FUNDS_YEARS_UNTIL_RETIREMENT_OUT_OF_RANGE");
  });
});
