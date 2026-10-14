import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";

const home=readFileSync("src/app/page.tsx","utf8");
const hero=readFileSync("src/components/HeroStrategyPreview.tsx","utf8");
const interaction=readFileSync("src/components/PublicLandingInteractivity.tsx","utf8");
const css=readFileSync("src/app/marketing-home.css","utf8");

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
 it("animates an explicitly illustrative portfolio value alongside its SVG clip reveal",()=>{
  expect(home).toContain("<HeroStrategyPreview/>");
  expect(hero).toContain("ILLUSTRATIVE DATA");
  expect(hero).toContain("MarketingHeroChart");
  expect(hero).toContain("setProgress(1-Math.pow(1-t,3))");
  expect(hero).toContain("revealProgress={progress}");
  const chart=readFileSync("src/components/MarketingHeroChart.tsx","utf8");
  expect(chart).toContain("width={400*revealProgress}");
  expect(chart).toContain("fmt.format(visibleCurrent)");
  expect(chart).toContain("Fictional example · not investment performance");
  expect(hero).toContain("START+(END-START)*progress");
  expect(hero).toContain("prefers-reduced-motion: reduce");
  expect(hero).toContain("IntersectionObserver");
 });
 it("removes the redundant reassurance banner and compresses the strategy display",()=>{
  expect(home).not.toContain("Elegant where it matters");
  expect(home.indexOf('id="strategies"')).toBeLessThan(home.indexOf('id="how"'));
  expect(css).toContain(".wm-strategy-section{padding-top:68px");
  expect(css).not.toContain(".wm-trust-grid{");
 });
});
