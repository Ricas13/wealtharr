import {describe,expect,it} from "vitest";
import {isSinglePeriodPrice} from "@/domain/billing-price";

describe("fixed monthly/annual subscription pricing",()=>{
  const monthly={billing_scheme:"per_unit",transform_quantity:null,recurring:{interval_count:1,usage_type:"licensed"}};
  it("accepts a fixed charge each single billing period",()=>{
    expect(isSinglePeriodPrice(monthly)).toBe(true);
  });
  it.each([0,2,3,12])("rejects a %i-period charge advertised as one period",interval_count=>{
    expect(isSinglePeriodPrice({...monthly,recurring:{...monthly.recurring,interval_count}})).toBe(false);
  });
  it("rejects missing cadence, metered, tiered and quantity-transformed charges",()=>{
    expect(isSinglePeriodPrice({})).toBe(false);
    expect(isSinglePeriodPrice({...monthly,recurring:{interval_count:1,usage_type:"metered"}})).toBe(false);
    expect(isSinglePeriodPrice({...monthly,billing_scheme:"tiered"})).toBe(false);
    expect(isSinglePeriodPrice({...monthly,transform_quantity:{divide_by:10,round:"up"}})).toBe(false);
  });
});
