import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {checkCommercialLaunch} from "@/domain/commercial-launch";
import {SETTING_KEYS} from "@/domain/settings-registry";

describe("customer legal and merchant disclosures",()=>{
 it("provides reachable public terms and privacy pages with explicit prelaunch status",()=>{
  const terms=readFileSync("src/app/terms/page.tsx","utf8");
  const privacy=readFileSync("src/app/privacy/page.tsx","utf8");
  expect(terms).toContain("Automatic renewal and cancellation");
  expect(terms).toContain("Manage billing");
  expect(terms).toContain("Not yet provided");
  expect(privacy).toContain("Privacy notice");
  expect(privacy).toContain("Data protection information");
  expect(privacy).toContain("operator review");
 });
 it("can configure and show the true operator identity, address, and support from admin",()=>{
  for(const key of ["WEALTHARR_LEGAL_TRADING_ENTITY","WEALTHARR_LEGAL_BUSINESS_ADDRESS","WEALTHARR_SUPPORT_EMAIL"]){
   expect(SETTING_KEYS.has(key)).toBe(true);
   expect(readFileSync("src/app/terms/page.tsx","utf8")).toContain(key);
   expect(readFileSync("src/app/privacy/page.tsx","utf8")).toContain(key);
  }
 });
 it("does not mistake authored draft legal pages for verified legal signoff",()=>{
  const keys=checkCommercialLaunch({});
  expect(keys.find(k=>k.key==="legal_public_pages")?.passed).toBe(false);
  expect(keys.find(k=>k.key==="seller_identity")?.passed).toBe(false);
 });
});
