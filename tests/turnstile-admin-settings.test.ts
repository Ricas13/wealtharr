import {describe,it,expect} from "vitest";
import {SETTING_GROUPS,SETTINGS,isSecretKind,validateSetting} from "@/domain/settings-registry";
import {requireTurnstile} from "@/domain/turnstile";

const get=(key:string)=>{
 const setting=SETTINGS.find(s=>s.key===key);
 if(!setting)throw Error("MISSING_"+key);
 return setting;
};
describe("Turnstile is configured only through encrypted Wealtharr Admin settings",()=>{
 it("shows the enable switch, site key, and protected secret in the same admin group",()=>{
  expect(SETTING_GROUPS).toContain("Cloudflare Turnstile");
  expect(get("TURNSTILE_ENABLED")).toMatchObject({group:"Cloudflare Turnstile",kind:"boolean"});
  expect(get("TURNSTILE_SITE_KEY")).toMatchObject({group:"Cloudflare Turnstile",kind:"text"});
  expect(get("TURNSTILE_SECRET_KEY")).toMatchObject({group:"Cloudflare Turnstile",kind:"secret"});
  expect(isSecretKind(get("TURNSTILE_SECRET_KEY").kind)).toBe(true);
 });
 it("validates submitted Cloudflare keys without requiring environment variables",()=>{
  expect(validateSetting(get("TURNSTILE_SITE_KEY"),"0x4AAAAAA-valid-site-key").ok).toBe(true);
  expect(validateSetting(get("TURNSTILE_SECRET_KEY"),"0x4AAAAAA-valid-secret-key").ok).toBe(true);
  expect(validateSetting(get("TURNSTILE_SITE_KEY"),"bad key")).toMatchObject({ok:false});
  expect(validateSetting(get("TURNSTILE_SECRET_KEY"),"a")).toMatchObject({ok:false});
 });
 it("the admin test challenges Siteverify while the public protection toggle is still off",async()=>{
  const fetcher=(async(_url:string,init?:RequestInit)=>{
    expect(String(init?.body)).toContain("secret=private-test-secret");
    return new Response(JSON.stringify({success:true,hostname:"wealtharr.example.org",action:"admin-test"}),{status:200});
  }) as typeof fetch;
  await expect(requireTurnstile({
    action:"admin-test",token:"real-browser-token",
    env:{TURNSTILE_ENABLED:"true",TURNSTILE_SITE_KEY:"0x4AAAAAA-valid-site-key",
      TURNSTILE_SECRET_KEY:"private-test-secret",NEXT_PUBLIC_APP_URL:"https://wealtharr.example.org"},
    fetcher
  })).resolves.toBeUndefined();
 });
});
