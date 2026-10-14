import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {currencyMinorDigits,majorFromMinor,minorFromMajor,exactPriceString,formatMinorCurrency} from "@/domain/currency-money";

describe("currency-accurate pricing across public and admin views",()=>{
 it("interprets GBP USD EUR as cents, JPY as whole units and KWD as thousandths",()=>{
  expect(currencyMinorDigits("GBP")).toBe(2);
  expect(currencyMinorDigits("USD")).toBe(2);
  expect(currencyMinorDigits("EUR")).toBe(2);
  expect(currencyMinorDigits("JPY")).toBe(0);
  expect(currencyMinorDigits("KWD")).toBe(3);
  expect(majorFromMinor(999,"GBP")).toBe(9.99);
  expect(majorFromMinor(1299,"KWD")).toBe(1.299);
  expect(majorFromMinor(2000,"JPY")).toBe(2000);
  expect(minorFromMajor(9.99,"GBP")).toBe(999);
  expect(minorFromMajor(1.299,"KWD")).toBe(1299);
  expect(minorFromMajor(2000,"JPY")).toBe(2000);
 });
 it("rounds only at the new currency precision, without any claimed FX conversion",()=>{
  expect(minorFromMajor(majorFromMinor(999,"GBP"),"JPY")).toBe(10);
  expect(minorFromMajor(majorFromMinor(1234,"KWD"),"GBP")).toBe(123);
  expect(()=>minorFromMajor(-5,"GBP")).toThrow();
  expect(()=>minorFromMajor(Number.NaN,"GBP")).toThrow();
 });
 it("represents zero-, two- and three-decimal prices correctly in schema offers",()=>{
  expect(exactPriceString(9900,"GBP")).toBe("99.00");
  expect(exactPriceString(299,"JPY")).toBe("299");
  expect(exactPriceString(1234,"KWD")).toBe("1.234");
  expect(formatMinorCurrency(999,"GBP")).toMatch(/£9\.99/);
  expect(formatMinorCurrency(299,"JPY")).toMatch(/299/);
 });
 it("uses one formatter for public pricing and exact SEO metadata",()=>{
  const landing=readFileSync("src/components/PublicLandingInteractivity.tsx","utf8");
  const pricing=readFileSync("src/app/pricing/page.tsx","utf8");
  const home=readFileSync("src/app/page.tsx","utf8");
  expect(landing).toContain("return formatMinorCurrency(amount,currency)");
  expect(pricing).toContain("formatMinorCurrency(Number(row.monthly_price_minor),String(row.billing_currency))");
  expect(pricing).toContain("formatMinorCurrency(Number(row.annual_price_minor),String(row.billing_currency))");
  expect(home).toContain("exactPriceString(offered.monthlyMinor!,offered.currency)");
  expect(landing).not.toContain(".format(amount/100)");
  expect(pricing).not.toContain("monthly_price_minor)/100");
  expect(pricing).not.toContain("annual_price_minor)/100");
  expect(home).not.toContain("(offered.monthlyMinor!/100)");
 });
 it("prevents the plan editor from applying hidden hundredfold amount conversions",()=>{
  const editor=readFileSync("src/components/SimplePlanEditor.tsx","utf8");
  expect(editor).toContain("const priceStep=1/10**currencyMinorDigits(form.currency)");
  expect(editor).toContain("majorFromMinor(form.monthlyPriceMinor,form.currency)");
  expect(editor).toContain("minorFromMajor(Number(e.target.value||\"0\"),form.currency)");
  expect(editor).toContain("function changeCurrency(next:string)");
  expect(editor).toContain("it does not perform a foreign-exchange conversion");
  expect(editor).not.toContain("form.monthlyPriceMinor/100");
  expect(editor).not.toContain("form.annualPriceMinor/100");
 });
});
