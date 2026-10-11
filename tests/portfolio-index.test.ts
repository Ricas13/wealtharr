import {describe,expect,it} from "vitest";
import {growthIndex} from "../src/domain/portfolio-analytics";
describe("flow-adjusted chart index",()=>{
 it("a pure contribution changes cash value, not the indexed return",()=>{
  expect(growthIndex([
   {date:"2026-01-01",value:"1000"},{date:"2026-01-02",value:"1500"}
  ],[{date:"2026-01-02",amount:"500"}]).map(p=>p.value)).toEqual(["100","100"]);
 });
 it("a 10% gain after adding money is a 10% index gain",()=>{
  expect(growthIndex([
   {date:"2026-01-01",value:"1000"},{date:"2026-01-02",value:"1100"},{date:"2026-01-03",value:"1650"}
  ],[{date:"2026-01-03",amount:"440"}]).map(p=>Number(p.value))).toEqual([100,110,121]);
 });
});