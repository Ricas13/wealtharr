import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {absolutePublicUrl,publicIndexingEnabled,publicSeoRoutes,privateRoutePrefixes,safeJsonLd} from "../src/lib/public-seo";
import {learningGuides} from "../src/components/LearningGuide";

const file=(p:string)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
describe("indexable educational content and investment risk honesty",()=>{
 it("whitelists only original public guides and a canonical research disclosure",()=>{
  expect(publicSeoRoutes).toContain("/learn");
  expect(publicSeoRoutes).toContain("/research-disclaimer");
  for(const guide of learningGuides){
   expect(publicSeoRoutes).toContain(guide.path);
   const path="src/app"+guide.path+"/page.tsx";
   const content=file(path);
   expect(content).toContain('alternates:{canonical:"'+guide.path+'"}');
   expect(content).toContain("<LearningGuide");
   expect(content).toContain("<h2>");
   expect(absolutePublicUrl(guide.path,"https://wealtharr.example")).toBe("https://wealtharr.example"+guide.path);
  }
  for(const path of publicSeoRoutes){
   expect(privateRoutePrefixes.some(prefix=>path===prefix||path.startsWith(prefix+"/"))).toBe(false);
  }
  expect(new Set(publicSeoRoutes).size).toBe(publicSeoRoutes.length);
 });
 it("keeps indexing off unless the real HTTPS production operator explicitly opts in",()=>{
  expect(publicIndexingEnabled({NODE_ENV:"production",NEXT_PUBLIC_APP_URL:"https://wealtharr.example",PUBLIC_INDEXING_ENABLED:"false"})).toBe(false);
  expect(publicIndexingEnabled({NODE_ENV:"development",NEXT_PUBLIC_APP_URL:"https://wealtharr.example",PUBLIC_INDEXING_ENABLED:"true"})).toBe(false);
  expect(publicIndexingEnabled({NODE_ENV:"production",NEXT_PUBLIC_APP_URL:"https://wealtharr.example",PUBLIC_INDEXING_ENABLED:"true"})).toBe(true);
 });
 it("never nests private user routes inside the public sitemap",()=>{
  const code=file("src/app/sitemap.ts");
  expect(code).toContain("publicSeoRoutes.map");
  expect(code).toContain("await ensureSettings()");
  expect(code).toContain('dynamic="force-dynamic"');
  const robots=file("src/app/robots.ts");
  expect(robots).toContain("await ensureSettings()");
  expect(robots).toContain('dynamic="force-dynamic"');
  expect(code).toContain("publicIndexingEnabled");
 });
 it("prevents markup injection and publishes genuine visible guide content",()=>{
  expect(safeJsonLd({str:"</script>"})).not.toContain("</script>");
  const guide=file("src/components/LearningGuide.tsx");
  expect(guide).toContain("BreadcrumbList");
  expect(guide).toContain("Article");
  expect(guide).toContain("{children}");
  expect(file("src/app/learn/leveraged-etp-risks/page.tsx")).toContain("Daily leverage is not a long-term multiple");
  expect(file("src/app/learn/portfolio-rebalancing/page.tsx")).toContain("worked 60/40");
 });
 it("puts the accurate educational disclaimer on public and authenticated views",()=>{
  const disclosure=file("src/components/ResearchDisclaimer.tsx");
  const layout=file("src/app/layout.tsx");
  expect(disclosure).toContain("For research and educational purposes only.");
  expect(disclosure).toContain("does not assess suitability");
  expect(disclosure).toContain("never places trades");
  expect(disclosure).toContain('href="/research-disclaimer"');
  expect(layout).toContain("<ResearchDisclaimer/>");
  expect(file("src/app/app/strategies/[id]/page.tsx")).toContain("Research calculation only — not personal financial advice.");
  expect(file("src/app/research-disclaimer/page.tsx")).toContain("This disclosure does not override applicable law or regulation.");
  expect(layout).not.toContain('alternates:{canonical:"/"}');
  expect(file("src/app/page.tsx")).toContain('alternates:{canonical:"/"}');
 });
 it("does not misrepresent Yahoo's public endpoints as licensed commercial data",()=>{
  expect(file(".env.example")).toContain("MARKET_DATA_PROVIDER=yahoo");
  expect(file("src/domain/commercial-launch.ts")).toContain("unofficial, not licensed for commercial redistribution");
  expect(file("src/lib/market-data.ts")).toContain('process.env.MARKET_DATA_PROVIDER === "yahoo"');
  expect(file("src/domain/commercial-launch.ts")).toContain('env.MARKET_DATA_PROVIDER==="http"');
 });
});
