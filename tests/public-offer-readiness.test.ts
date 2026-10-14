import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {canAdvertisePaidOffer} from "@/domain/public-offer-readiness";
import {checkCommercialLaunch} from "@/domain/commercial-launch";
const complete:Record<string,string>={
 WEALTHARR_PAID_LAUNCH_ENABLED:"true",
 NEXT_PUBLIC_APP_URL:"https://wealtharr.example",
 DATABASE_URL:"postgres://app:pass@db:5432/wealtharr",
 AUTH_SECRET:"a".repeat(40),
 APP_ENCRYPTION_KEY:Buffer.alloc(32,7).toString("base64"),
 CRON_SECRET:"b".repeat(40),
 STRIPE_SECRET_KEY:"sk_live_"+"x".repeat(40),
 STRIPE_WEBHOOK_SECRET:"whsec_"+"x".repeat(40),
 EMAIL_PROVIDER:"http",
 EMAIL_HTTP_ENDPOINT:"https://mailer.example.org/send",
 EMAIL_HTTP_TOKEN:"c".repeat(24),
 EMAIL_FROM:"support@wealtharr.example",
 MARKET_DATA_PROVIDER:"http",
 MARKET_DATA_HTTP_BASE_URL:"https://market.example.org",
 MARKET_DATA_HTTP_TOKEN:"d".repeat(24),
 TURNSTILE_ENABLED:"true",
 TURNSTILE_SITE_KEY:"real_turnstile_site_key_12345",
 TURNSTILE_SECRET_KEY:"real_turnstile_secret_key_12345",
 ADMIN_MFA_REQUIRED:"true",
 BACKUPS_RESTORE_VERIFIED:"true",
 UK_REGULATORY_SIGNOFF_VERIFIED:"true",
 REGIONAL_INSTRUMENTS_VERIFIED:"true"
};
describe("public paid Offer preflight",()=>{
 it("does not advertise when checkout is switched off, key is test-mode or an approval is missing",()=>{
  expect(canAdvertisePaidOffer({...complete,WEALTHARR_PAID_LAUNCH_ENABLED:"false"})).toBe(false);
  expect(canAdvertisePaidOffer({...complete,STRIPE_SECRET_KEY:"sk_test_"+"x".repeat(40)})).toBe(false);
  expect(canAdvertisePaidOffer({...complete,STRIPE_SECRET_KEY:""})).toBe(false);
  expect(canAdvertisePaidOffer({...complete,UK_REGULATORY_SIGNOFF_VERIFIED:"false"})).toBe(false);
  expect(canAdvertisePaidOffer({...complete,MARKET_DATA_PROVIDER:"yahoo"})).toBe(false);
 });
 it("only passes when all current launch configuration gates pass",()=>{
  expect(checkCommercialLaunch(complete).filter(x=>!x.passed)).toEqual([]);
  expect(canAdvertisePaidOffer(complete)).toBe(true);
 });
 it("refreshes settings and removes schema offer from disabled checkout without hiding plan comparisons",()=>{
  const home=readFileSync("src/app/page.tsx","utf8");
  expect(home).toContain("await ensureSettings()");
  expect(home).toContain("canAdvertisePaidOffer(process.env)?plans.find");
  expect(home).toContain("exactPriceString(offered.monthlyMinor!,offered.currency)");
  expect(home).toContain("<PublicPricingCards plans={plans}/>");
 });
});
