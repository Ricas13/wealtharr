import {describe,expect,it} from "vitest";
import {portfolioAllocationBreakdown} from "@/domain/portfolio-allocation-view";
const strategies=[{id:"a",name:"First"},{id:"b",name:"Second"}];
describe("Portfolio allocation preview",()=>{
 it("uses only a complete common-currency snapshot",()=>{
  const a=portfolioAllocationBreakdown(strategies,[
   {strategy_instance_id:"a",value:"750.00",currency:"GBP"},
   {strategy_instance_id:"b",value:"250",currency:"GBP"}
  ]);
  expect(a).toMatchObject({currency:"GBP",total:1000,items:[{name:"First",sharePct:75},{name:"Second",sharePct:25}]});
 });
 it("never invents a value for missing histories, missing ids or empty sets",()=>{
  expect(portfolioAllocationBreakdown(strategies,[{strategy_instance_id:"a",value:"500",currency:"GBP"}])).toBeNull();
  expect(portfolioAllocationBreakdown(strategies,[])).toBeNull();
  expect(portfolioAllocationBreakdown([],[])).toBeNull();
 });
 it("refuses cross-currency addition and duplicate or invalid rows",()=>{
  expect(portfolioAllocationBreakdown(strategies,[
    {strategy_instance_id:"a",value:"500",currency:"GBP"},
    {strategy_instance_id:"b",value:"300",currency:"USD"}
  ])).toBeNull();
  expect(portfolioAllocationBreakdown(strategies,[
    {strategy_instance_id:"a",value:"500",currency:"GBP"},
    {strategy_instance_id:"a",value:"300",currency:"GBP"}
  ])).toBeNull();
  expect(portfolioAllocationBreakdown(strategies,[
    {strategy_instance_id:"a",value:null,currency:"GBP"},
    {strategy_instance_id:"b",value:"300",currency:"GBP"}
  ])).toBeNull();
  expect(portfolioAllocationBreakdown(strategies,[
    {strategy_instance_id:"a",value:"-1",currency:"GBP"},
    {strategy_instance_id:"b",value:"300",currency:"GBP"}
  ])).toBeNull();
 });
 it("does not draw an allocation when every tracked value is zero",()=>{
  expect(portfolioAllocationBreakdown(strategies,[
   {strategy_instance_id:"a",value:0,currency:"GBP"},
   {strategy_instance_id:"b",value:0,currency:"GBP"}
  ])).toBeNull();
 });
});
