import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";

const home=readFileSync(resolve(process.cwd(),"src/app/page.tsx"),"utf8");
const heroPreview=readFileSync(resolve(process.cwd(),"src/components/HeroStrategyPreview.tsx"),"utf8");
const interactivity=readFileSync(resolve(process.cwd(),"src/components/PublicLandingInteractivity.tsx"),"utf8");
const css=readFileSync(resolve(process.cwd(),"src/app/marketing-home.css"),"utf8");
const planApi=readFileSync(resolve(process.cwd(),"src/app/api/admin/plans/route.ts"),"utf8");
const planEditor=readFileSync(resolve(process.cwd(),"src/components/SimplePlanEditor.tsx"),"utf8");

describe("approved public homepage financial and commercial boundaries",()=>{
  it("does not market proprietary 9Sig or claim example data are real",()=>{
    expect(home).not.toMatch(/9Sig.*ISA|Buy £842/);
    expect(home).toContain('plugin.key.toLowerCase()==="9sig"');
    expect(heroPreview).toContain("ILLUSTRATIVE DATA");
    expect(home).toContain("No trades placed");
  });
  it("only displays published, code-verified, fully mapped strategies",()=>{
    expect(home).toContain("d.enabled=true");
    expect(home).toContain("v.lifecycle_status='PUBLISHED'");
    expect(home).toContain("assertCuratedRules(");
    expect(home).toContain("isOfferableForUser(");
    expect(home).toContain("if(!market.offerable)return [];");
    expect(home).toContain('country:"GB",wrapper:"ISA",currency:"GBP"');
  });
  it("renders 0-5 administrator-published plan offers without fabricated prices",()=>{
    expect(home).toContain("p.visible=true AND p.archived=false");
    expect(home).toContain("mo.active=true");
    expect(home).toContain("yr.active=true");
    expect(home).toContain("LIMIT 5");
    expect(planApi).toContain("pg_advisory_xact_lock");
    expect(planApi).toContain("PUBLIC_PLAN_LIMIT_5");
    expect(planApi).toContain("homepage_highlights");
    expect(planEditor).toContain("Homepage card highlights");
    expect(interactivity).toContain("wm-marketing-notes");
    expect(home).toContain("catch{/* No invented plans/prices");
    expect(home).toContain("planCurrencyPrices(row.prices)");
    expect(home).toContain("currencyForVisitorCountry(");
    expect(interactivity).toContain("p.prices[currency]");
    expect(interactivity).toContain("No estimated conversion.");
    expect(interactivity).toContain("LandingCurrencyProvider");
    expect(home).toContain('cards={carouselCards}');
    expect(home).not.toContain("Elegant where it matters");
    expect(home.indexOf('id="strategies"')).toBeLessThan(home.indexOf('id="how"'));
    expect(interactivity).toContain("pausedUntil.current");
    expect(interactivity).toContain("window.localStorage.setItem(STORAGE_KEY,next)");
    expect(interactivity).toContain("if(!plans.length)");
    expect(interactivity).toContain("p.features.map(");
    expect(interactivity).toContain("p.channels.map(");
    expect(interactivity).toContain('href="/register"');
  });
  it("keeps the palette scoped and the carousel accessible",()=>{
    expect(css).toContain(".wealtharr-marketing");
    expect(css).toContain("--wm-bg:#080d11");
    expect(css).toContain("@media(prefers-reduced-motion:reduce)");
    expect(interactivity).toContain('aria-label="Scroll strategies left"');
    expect(interactivity).toContain('aria-label="Scroll strategies right"');
    expect(interactivity).toContain("requestAnimationFrame");
  });
});
