import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";

const home=readFileSync("src/app/page.tsx","utf8");
const hero=readFileSync("src/components/AllocationObservatory.tsx","utf8");
const interaction=readFileSync("src/components/PublicLandingInteractivity.tsx","utf8");
const css=readFileSync("src/app/marketing-home.css","utf8");
const observatoryCss=readFileSync("src/app/marketing-observatory.css","utf8");

describe("marketing page animated strategy story",()=>{
 it("always fills the strategy carousel with clearly educational examples when nothing is released",()=>{
  expect(home).toContain("EDUCATIONAL_EXAMPLES:PublicStrategyCard[]");
  expect(home).toContain("const carouselCards=[...strategies,");
  expect(home).toContain("Educational strategy example");
  expect(home).toContain("only released methods with eligible instruments can be started");
  expect(interaction).toContain("cards.map((c,i)=>render(c,i,true))");
  expect(interaction).toContain("requestAnimationFrame(tick)");
  expect(interaction).toContain("onMouseEnter={()=>held.current=true}");
 });
 it("replaces the fictional line reveal with truthful and accessible allocation geometry",()=>{
  expect(home).toContain("<AllocationObservatory/>");
  expect(home).not.toContain("<HeroStrategyPreview/>");
  expect(hero).toContain("calculateInstrument(contribution,equity)");
  expect(hero).toContain("strokeDasharray");
  expect(hero).toContain("onPointerDown=");
  expect(hero).toContain('type="range"');
  expect(hero).toContain("Illustrative");
  expect(hero).toContain("No market prices, returns, trades or actual strategy schedules");
  expect(observatoryCss).toContain("prefers-reduced-motion:reduce");
  expect(observatoryCss).toContain(".wm-hero.wm-hero-observatory");
 });
 it("removes the redundant reassurance banner and compresses the strategy display",()=>{
  expect(home).not.toContain("Elegant where it matters");
  expect(home.indexOf('id="strategies"')).toBeLessThan(home.indexOf('id="how"'));
  expect(css).toContain(".wm-strategy-section{padding-top:68px");
  expect(css).not.toContain(".wm-trust-grid{");
 });
});
