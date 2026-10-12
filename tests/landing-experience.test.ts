import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
const style = readFileSync(new URL("../src/app/landing.css", import.meta.url), "utf8");
const demo = readFileSync(new URL("../src/components/LandingInteractiveDemo.tsx", import.meta.url), "utf8");
const marquee = readFileSync(new URL("../src/components/StrategyMarquee.tsx", import.meta.url), "utf8");

describe("public homepage conversion and integrity", () => {
  it("includes every section without inventing trust or financial claims", () => {
    for (const key of ['id="how-it-works"', '<StrategyMarquee strategies={strategies}/>', '<LandingInteractiveDemo/>',
      'landing-difference-grid', 'id="trust"', 'landing-last-cta']) {
      expect(page).toContain(key);
    }
    expect(page).not.toMatch(/guaranteed returns|outperform the market|trusted by [0-9]+/i);
    expect(page).toContain("Fictional balances and allocations");
  });

  it("conditionally renders pricing from the configured published plan list", () => {
    expect(page).toContain("loadPublicPlans()");
    expect(page).toContain("plans.length>0&&<section");
    expect(page).toContain("<PublicPlanCards plans={plans}/>");
    expect(page).not.toContain("£9.99");
    expect(page).not.toContain("£29.99");
  });

  it("is navigable and honours accessibility preferences", () => {
    expect(page).toContain("landing-skip");
    expect(style).toContain(":focus-visible");
    expect(style).toContain("prefers-reduced-motion:reduce");
    expect(style).toContain("@media (max-width:640px)");
    expect(marquee).toContain("prefers-reduced-motion: reduce");
    expect(marquee).toContain("hoveringRef.current");
    expect(marquee).toContain("focusedRef.current");
    expect(marquee).toContain("document.hidden");
  });

  it("labels the demonstration honestly and makes the input interactive", () => {
    expect(demo).toContain('type="range"');
    expect(demo).toContain("SIMULATED");
    expect(demo).toContain("No account required");
    expect(demo).toContain("not market data");
    expect(demo).toContain("calculateLandingDemo(");
  });
});