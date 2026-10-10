import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
const operations=readFileSync("src/app/admin/operations/page.tsx","utf8");
const launch=readFileSync("src/app/admin/launch/page.tsx","utf8");
const stripe=readFileSync("src/app/api/admin/operations/connect-stripe/route.ts","utf8");
describe("Master Admin is authoritative for provider configuration",()=>{
 it("refreshes encrypted settings before displaying launch and operations status",()=>{
  for(const code of [operations,launch])
    expect(code.indexOf("await ensureSettings(true)")).toBeLessThan(code.indexOf("checkCommercialLaunch(process.env)"));
 });
 it("refreshes Master Admin saved Stripe key before installing webhook",()=>{
  expect(stripe.indexOf("await ensureSettings(true)")).toBeLessThan(stripe.indexOf("const key=process.env.STRIPE_SECRET_KEY"));
 });
 it("does not incorrectly instruct operators to change shared scheduler credentials in the web GUI",()=>{
  expect(operations).toContain("private Docker Compose configuration");
  expect(launch).toContain("private Docker Compose configuration");
  expect(operations).not.toContain("Generate the job secret in Admin");
 });
});
