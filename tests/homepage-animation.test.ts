import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";

const home=readFileSync("src/app/page.tsx","utf8");
const client=readFileSync("src/components/PublicStrategyComparison.tsx","utf8");
const styles=readFileSync("src/app/marketing-simple.css","utf8");

describe("minimal marketing narrative",()=>{
 it("has only headline, interactive returns and plan cards",()=>{
  expect(home).toContain("<PublicStrategyComparison");
  expect(home).toContain("<PublicPricingCards");
  expect(home).not.toContain("HeroStrategyPreview");
  expect(home).not.toContain("AllocationObservatory");
  expect(home).not.toContain("PublicStrategyRail");
 });
 it("uses real user-selected strategy comparisons instead of fictional animated performance",()=>{
  expect(client).toContain("useState<string[]>");
  expect(client).toContain("alignedWindow(");
  expect(client).toContain("chartRows(");
  expect(client).toContain("spy.length===0");
  expect(styles).toContain(".wm-simple .wm-compare-no-chart");
 });
 it("keeps the hero readable without extra steps or forced scroll animation",()=>{
  expect(styles).toContain(".wm-simple .wm-simple-hero");
  expect(styles).toContain("@media(max-width:720px)");
  expect(home).not.toContain("id=\"how\"");
  expect(home).not.toContain("id=\"preview\"");
 });
});
