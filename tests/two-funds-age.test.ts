import {describe,expect,it} from "vitest";
import {classicTwoFundsAgeWeights} from "../src/domain/strategy/two-funds-age";

describe("Merriman classic age glide-path reference (not trade executable)",()=>{
  it.each([
    [20,"0.3000","0.7000"],
    [30,"0.4500","0.5500"],
    [40,"0.6000","0.4000"],
    [50,"0.7500","0.2500"],
    [60,"0.9000","0.1000"],
    [66,"0.9900","0.0100"],
    [67,"1.0000","0.0000"],
    [70,"1.0000","0.0000"]
  ])("age %i has exact split", (age,targetDateFund,smallCapValue)=>{
    expect(classicTwoFundsAgeWeights(age)).toEqual({targetDateFund,smallCapValue});
  });
  it.each([-1,0,19,NaN,21.5,Infinity])("rejects invalid age %s",age=>{
    expect(()=>classicTwoFundsAgeWeights(age)).toThrow("TWO_FUNDS_AGE_OUT_OF_RANGE");
  });
});
