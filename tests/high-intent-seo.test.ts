import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {publicSeoRoutes,publicIndexingEnabled,privateRoutePrefixes} from "../src/lib/public-seo";
const read=(path:string)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");

describe("high-intent SEO and free spreadsheet quality",()=>{
 it("serves one original, self-canonical and crawlable comparison, not doorway/keyword pages",()=>{
  const path="/learn/portfolio-tracking-spreadsheet";
  expect(publicSeoRoutes).toContain(path);
  expect(publicSeoRoutes.filter(x=>x.startsWith(path)).length).toBe(1);
  const content=read("src/app"+path+"/page.tsx");
  expect(content).toContain('alternates:{canonical:"'+path+'"}');
  expect(content).toContain("worked example");
  expect(content).toContain("£10,500");
  expect(content).toContain("£6,300");
  expect(content).toContain("£4,200");
  expect(content).toContain('href="/downloads/portfolio-tracking-template.csv"');
  expect(content).toContain("These numbers illustrate a calculation.");
 });
 it("gives visitors a usable CSV without claiming that example entries are actual trades",()=>{
  const csv=read("public/downloads/portfolio-tracking-template.csv");
  const lines=csv.trim().split("\n");
  expect(lines).toHaveLength(3);
  expect(lines[0]).toContain("ISIN");
  expect(lines[0]).toContain("Confirmed unit price");
  expect(lines[0]).toContain("Fees");
  expect(lines[1]).toContain("ILLUSTRATIVE BUY");
  expect(lines[2]).toContain("ILLUSTRATIVE CONTRIBUTION");
  expect(read("next.config.ts")).toContain('"/downloads/:path*"');
 });
 it("links useful educational content from actual public pages",()=>{
  expect(read("src/app/page.tsx")).toContain('href="/learn"');
  expect(read("src/app/features/page.tsx")).toContain('href="/learn/portfolio-tracking-spreadsheet"');
  expect(read("src/app/tools/rebalance-calculator/page.tsx")).toContain('href="/learn/portfolio-tracking-spreadsheet"');
  expect(read("src/components/LearningGuide.tsx")).toContain('path:"/learn/portfolio-tracking-spreadsheet"');
 });
 it("serves a real branded 1200x630 image instead of inventing fake performance badges or testimonials",()=>{
  const image=read("src/app/opengraph-image.tsx");
  expect(image).toContain("new ImageResponse(");
  expect(image).toContain("width:1200,height:630");
  expect(image).toContain("For research purposes only");
  expect(image).not.toMatch(/aggregateRating|reviewCount|five.star|100% guaranteed/);
  expect(read("src/app/layout.tsx")).toContain('card:"summary_large_image"');
 });
 it("preserves opt-in only HTTPS indexing and blocks personal or download routes",()=>{
  expect(publicIndexingEnabled({NODE_ENV:"production",PUBLIC_INDEXING_ENABLED:"false",NEXT_PUBLIC_APP_URL:"https://example.com"})).toBe(false);
  expect(publicIndexingEnabled({NODE_ENV:"production",PUBLIC_INDEXING_ENABLED:"true",NEXT_PUBLIC_APP_URL:"https://example.com"})).toBe(true);
  expect(privateRoutePrefixes.every(p=>!publicSeoRoutes.some(x=>x===p||x.startsWith(p+"/")))).toBe(true);
  const sitemap=read("src/app/sitemap.ts");
  expect(sitemap).toContain('lastModified:new Date("2026-10-16T00:00:00.000Z")');
  expect(sitemap).not.toContain("lastModified:new Date()");
 });
 it("includes a coherent publisher graph without claims of star ratings or guaranteed returns",()=>{
  const page=read("src/app/page.tsx");
  expect(page).toContain('"@type":"Organization"');
  expect(page).toContain('"@type":"SoftwareApplication"');
  expect(page).toContain('publisher:{"@id":origin+"#publisher"}');
  expect(page).not.toContain("aggregateRating");
 });
});
