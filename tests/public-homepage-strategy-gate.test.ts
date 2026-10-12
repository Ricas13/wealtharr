import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
const page=readFileSync(new URL("../src/app/page.tsx",import.meta.url),"utf8");
const carousel=readFileSync(new URL("../src/components/StrategyMarquee.tsx",import.meta.url),"utf8");

describe("public homepage strict strategy availability",()=>{
  it("never selects disabled, draft-only or unattested releases",()=>{
    expect(page).toContain("WHERE d.enabled=true AND d.proprietary=false");
    expect(page).toContain("v.lifecycle_status='PUBLISHED'");
    expect(page).toContain("a.attested_by_email IS NOT NULL");
    expect(page).toContain("assertCuratedRules(");
    expect(page).toContain("assessStrategyMarket(");
    expect(page).toContain("candidates,{country:\"GB\",wrapper:\"ISA\",currency:\"GBP\"}");
    expect(page).not.toContain("d.key NOT IN");
  });
  it("does not advertise unfinished strategies in marquee or fictional preview",()=>{
    expect(carousel).not.toContain("Research / draft");
    expect(carousel).toContain("if (!strategies.length) return null");
    expect(page).toContain("Illustrative portfolio A");
    expect(page).toContain("Illustrative portfolio B");
    expect(page).not.toContain("All Weather review ready");
    expect(page).toContain('strategies.length>0&&<a href="#strategies">');
  });
});
