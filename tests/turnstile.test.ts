import { describe,it,expect,vi } from "vitest";
import { requireTurnstile,turnstileEnabled,TurnstileError,TURNSTILE_SITEVERIFY } from "@/domain/turnstile";
const env={
  TURNSTILE_ENABLED:"true",
  TURNSTILE_SITE_KEY:"0x4AAAAF-test-site-key",
  TURNSTILE_SECRET_KEY:"secret-test-server-only",
  NEXT_PUBLIC_APP_URL:"https://wealtharr.example.org"
};
function response(obj:unknown,status=200){
  return new Response(JSON.stringify(obj),{status,headers:{"content-type":"application/json"}});
}
const good={success:true,hostname:"wealtharr.example.org",action:"register"};
const token="valid-single-use-token";
describe("Cloudflare Turnstile server-side security",()=>{
  it("skips optional widget when disabled, without network calls",async()=>{
    const fetcher=vi.fn();
    expect(turnstileEnabled({})).toBe(false);
    await requireTurnstile({env:{},action:"register",token:null,fetcher:fetcher as unknown as typeof fetch});
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("validates the token at fixed Cloudflare origin and never exposes credentials in the URL",async()=>{
    const fetcher=vi.fn(async(_url:unknown,_init?:RequestInit)=>response(good));
    await requireTurnstile({env,action:"register",token,fetcher:fetcher as typeof fetch});
    expect(fetcher).toHaveBeenCalledOnce();
    const [url,init]=fetcher.mock.calls[0] as [string,RequestInit];
    expect(url).toBe(TURNSTILE_SITEVERIFY);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect(init.cache).toBe("no-store");
    const body=init.body as URLSearchParams;
    expect(body.get("secret")).toBe(env.TURNSTILE_SECRET_KEY);
    expect(body.get("response")).toBe(token);
    expect(url).not.toContain(env.TURNSTILE_SECRET_KEY);
  });
  it("fails closed for missing/malformed/oversized tokens and incomplete configuration",async()=>{
    for(const bad of [undefined,"",true,"x".repeat(2049)]){
      await expect(requireTurnstile({env,action:"register",token:bad})).rejects.toMatchObject({code:"TURNSTILE_REQUIRED"});
    }
    await expect(requireTurnstile({env:{...env,TURNSTILE_SECRET_KEY:""},action:"register",token})).rejects.toMatchObject({code:"TURNSTILE_CONFIGURATION_ERROR"});
    await expect(requireTurnstile({env:{...env,NEXT_PUBLIC_APP_URL:"invalid"},action:"register",token})).rejects.toMatchObject({code:"TURNSTILE_CONFIGURATION_ERROR"});
  });
  it("rejects token replay, wrong hostname, wrong action, malformed result and provider errors",async()=>{
    const cases=[{success:false,"error-codes":["timeout-or-duplicate"]},{success:true,hostname:"evil.example.org",action:"register"},
      {success:true,hostname:"wealtharr.example.org",action:"reset"},{success:true,action:"register"},null,[]];
    for(const data of cases){
      await expect(requireTurnstile({env,action:"register",token,fetcher:vi.fn(async()=>response(data)) as typeof fetch})).rejects.toMatchObject({code:"TURNSTILE_REJECTED"});
    }
    await expect(requireTurnstile({env,action:"register",token,fetcher:vi.fn(async()=>response(good,500)) as typeof fetch})).rejects.toMatchObject({code:"TURNSTILE_UNAVAILABLE"});
    await expect(requireTurnstile({env,action:"register",token,fetcher:vi.fn(async()=>{throw Error("network")}) as typeof fetch})).rejects.toMatchObject({code:"TURNSTILE_UNAVAILABLE"});
  });
  it("requires the correct action for all protected flows",async()=>{
    for(const action of ["login","reset"] as const){
      const fetcher=vi.fn(async()=>response({...good,action}));
      await requireTurnstile({env,action,token,fetcher:fetcher as typeof fetch});
    }
  });
  it("uses a dedicated error class without leaking the submitted token",()=>{
    const e=new TurnstileError("TURNSTILE_REJECTED");
    expect(e.message).not.toContain(token);
    expect(e.code).toBe("TURNSTILE_REJECTED");
  });
});
