import {describe,expect,it} from "vitest";
import {filterAdminCustomerRows,type AdminCustomerRow} from "@/domain/admin-customer-filters";
const rows:AdminCustomerRow[]=[
 {email:"Ada@example.com",country:"GB",role:"USER",plan:"Investor",status:"ACTIVE",active:2,attention:0},
 {email:"Bob@example.com",country:"GB",role:"USER",plan:"Free",status:"FREE",active:0,attention:1},
 {email:"Cam@example.com",country:"PT",role:"USER",plan:"Pro",status:"PAST_DUE",active:2,attention:0},
 {email:"Dee@example.com",country:"GB",role:"ADMIN",plan:"Pro",status:"TRIALING",active:1,attention:2},
 {email:"Eve@example.com",country:"GB",role:"USER",plan:"Pro",status:"CANCELED",active:0,attention:0}
];
const apply=(quick:"ALL"|"SUBSCRIBED"|"STRATEGY_ATTENTION"|"BILLING_ATTENTION",query="",plan="ALL")=>
 filterAdminCustomerRows(rows,{quick,query,plan}).map(row=>row.email);
describe("Admin customer directory filters",()=>{
 it("returns all loaded customers with no filters",()=>expect(apply("ALL")).toHaveLength(5));
 it("searches emails and other displayed fields case-insensitively",()=>{
  expect(apply("ALL"," ADA ")).toEqual(["Ada@example.com"]);
  expect(apply("ALL","pt")).toEqual(["Cam@example.com"]);
  expect(apply("ALL","inVesTor")).toEqual(["Ada@example.com"]);
 });
 it("separates subscribed customers from free or past-due records",()=>{
  expect(apply("SUBSCRIBED")).toEqual(["Ada@example.com","Dee@example.com"]);
 });
 it("shows actual strategy attention only",()=>{
  expect(apply("STRATEGY_ATTENTION")).toEqual(["Bob@example.com","Dee@example.com"]);
 });
 it("flags payment status but not intentional cancellations",()=>{
  expect(apply("BILLING_ATTENTION")).toEqual(["Cam@example.com"]);
 });
 it("combines plan, quick filter and search",()=>{
  expect(apply("SUBSCRIBED","dee","Pro")).toEqual(["Dee@example.com"]);
  expect(apply("SUBSCRIBED","dee","Investor")).toEqual([]);
 });
 it("does not mutate the server-supplied order",()=>{
  const copy=rows.map(x=>x.email);apply("ALL");expect(rows.map(x=>x.email)).toEqual(copy);
 });
});
