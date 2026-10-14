import {describe,expect,it} from "vitest";
import {currencyForVisitorCountry} from "@/domain/visitor-currency";

describe("IP-country homepage currency defaults",()=>{
 it("uses sterling for the UK",()=>{
  expect(currencyForVisitorCountry("GB")).toBe("GBP");
  expect(currencyForVisitorCountry("uk")).toBe("GBP");
 });
 it("uses euros for European countries including Ireland and non-EU Europe",()=>{
  for(const code of ["FR","PT","DE","IE","ES","CH","NO","IT"])
   expect(currencyForVisitorCountry(code)).toBe("EUR");
 });
 it("defaults outside Europe, or without trusted geography, to USD",()=>{
  for(const country of ["US","CA","BR","AU","JP","XX",null,undefined,""])
   expect(currencyForVisitorCountry(country)).toBe("USD");
 });
});
