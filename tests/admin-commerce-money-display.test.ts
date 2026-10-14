import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {invoiceAmountMinor} from "@/domain/admin-stripe-invoices";

describe("Admin Commerce currency price display",()=>{
 it("handles 2-, 0- and 3-decimal billing currencies without assuming pennies",()=>{
  expect(invoiceAmountMinor(999,"GBP")).toMatch(/£9\.99/);
  expect(invoiceAmountMinor(1500,"JPY")).toMatch(/1,500/);
  expect(invoiceAmountMinor(1234,"KWD")).toContain("1.234");
  expect(invoiceAmountMinor(29900,"USD")).toMatch(/299\.00/);
 });
 it("uses currency-specific minor units for both plan and price catalogue values",()=>{
  const page=readFileSync("src/app/admin/plans/page.tsx","utf8");
  expect(page).toContain("invoiceAmountMinor(Number(p.monthly_price_minor),String(p.billing_currency))");
  expect(page).toContain("invoiceAmountMinor(Number(p.annual_price_minor),String(p.billing_currency))");
  expect(page).toContain("invoiceAmountMinor(Number(p.amount_minor),String(p.currency))");
  expect(page).not.toContain("(Number(p.monthly_price_minor)/100)");
  expect(page).not.toContain("(Number(p.annual_price_minor)/100)");
  expect(page).not.toContain("(Number(p.amount_minor)/100)");
  // Discounts are basis points, not money; their /100 conversion remains correct.
  expect(page).toContain("(Number(p.annual_discount_bps)/100)");
 });
});
