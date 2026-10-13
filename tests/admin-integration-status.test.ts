import {describe,expect,it} from "vitest";
import {describeIntegrationStatuses,type AdminSettingState} from "@/domain/admin-integration-status";

const setting=(key:string,value:string|null=null,source:AdminSettingState["source"]="database"):AdminSettingState=>({key,value,source});

describe("Admin Integrations configuration labels",()=>{
 it("does not call absent provider configuration connected",()=>{
  expect(describeIntegrationStatuses([])).toEqual({
   turnstile:"Needs setup",marketData:"Needs setup",payments:"Needs setup",communications:"Needs setup"
  });
 });
 it("distinguishes saved Turnstile keys from the enabled switch and from actual verification",()=>{
  const keys=[setting("TURNSTILE_SITE_KEY","site"),setting("TURNSTILE_SECRET_KEY")];
  expect(describeIntegrationStatuses(keys).turnstile).toBe("Keys saved · disabled");
  expect(describeIntegrationStatuses([...keys,setting("TURNSTILE_ENABLED","true")]).turnstile).toBe("Enabled · unverified");
  expect(describeIntegrationStatuses([setting("TURNSTILE_ENABLED","true")]).turnstile).toBe("Enabled · keys missing");
  expect(describeIntegrationStatuses([setting("TURNSTILE_SITE_KEY","site"),setting("TURNSTILE_SECRET_KEY",null,"unset")]).turnstile).toBe("Needs setup");
 });
 it("shows manual and unofficial market data modes without implying licensed commercial feeds",()=>{
  expect(describeIntegrationStatuses([setting("MARKET_DATA_MODE","MANUAL")]).marketData).toBe("Manual mode");
  expect(describeIntegrationStatuses([setting("MARKET_DATA_PROVIDER","yahoo")]).marketData).toBe("Unofficial feed");
  expect(describeIntegrationStatuses([setting("MARKET_DATA_HTTP_BASE_URL","https://data.example"),setting("MARKET_DATA_HTTP_TOKEN")]).marketData).toBe("Credentials saved");
 });
 it("marks saved payment secrets as configuration rather than verified payment processing",()=>{
  expect(describeIntegrationStatuses([setting("STRIPE_SECRET_KEY"),setting("STRIPE_WEBHOOK_SECRET")]).payments).toBe("Credentials saved");
  expect(describeIntegrationStatuses([setting("STRIPE_SECRET_KEY")]).payments).toBe("Needs setup");
 });
 it("does not represent mock email as successfully connected",()=>{
  expect(describeIntegrationStatuses([setting("EMAIL_PROVIDER","mock")]).communications).toBe("Mock mode · no delivery");
  expect(describeIntegrationStatuses([setting("EMAIL_HTTP_ENDPOINT","https://mail.example"),setting("EMAIL_HTTP_TOKEN")]).communications).toBe("Credentials saved");
 });
});
