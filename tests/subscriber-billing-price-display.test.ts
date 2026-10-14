import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {invoiceAmountMinor} from "@/domain/admin-stripe-invoices";

describe("subscriber pricing fidelity",()=>{
 it("supports precise 2-, 0-, and 3-decimal currency display",()=>{
  expect(invoiceAmountMinor(999,"GBP")).toMatch(/£9\.99/);
  expect(invoiceAmountMinor(9900,"GBP")).toMatch(/£99\.00/);
  expect(invoiceAmountMinor(2000,"JPY")).toMatch(/2,000/);
  expect(invoiceAmountMinor(1299,"KWD")).toContain("1.299");
 });
 it("uses configured minor-unit amounts without arbitrary annual price rounding",()=>{
  const code=readFileSync("src/components/SettingsForms.tsx","utf8");
  expect(code).toContain("invoiceAmountMinor(plan.monthly.amountMinor,currency)");
  expect(code).toContain("invoiceAmountMinor(plan.annual.amountMinor,currency)");
  expect(code).not.toContain("plan.monthly.amountMinor/100");
  expect(code).not.toContain("plan.annual.amountMinor/100");
  expect(code).not.toContain("maximumFractionDigits:0");
  expect(code).toContain("Choose monthly");
  expect(code).toContain("Annual · ");
 });
});
