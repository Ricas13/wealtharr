import { afterEach,describe,expect,it,vi } from "vitest";
import { readFileSync } from "node:fs";
import { isNonPublicHost } from "@/domain/network-host";
import { ENDPOINT_SECRET_PAIRS,settingByKey,validateSetting } from "@/domain/settings-registry";

const def=(key:string)=>settingByKey(key)!;
const host=(url:string)=>new URL(url).hostname;

afterEach(()=>{vi.unstubAllEnvs();});

describe("non-public hosts",()=>{
  it("flags loopback, private, shared, link-local, metadata and reserved IPv4 addresses",()=>{
    for(const ip of ["127.0.0.1","127.8.8.8","10.0.0.5","172.16.0.1","172.31.255.255","192.168.1.1","169.254.169.254","100.64.0.1","0.0.0.0","198.18.0.1","224.0.0.1","255.255.255.255"]){
      expect(isNonPublicHost(ip),ip).toBe(true);
    }
  });
  it("does not flag public IPv4 addresses next to the private ranges",()=>{
    for(const ip of ["8.8.8.8","172.15.0.1","172.32.0.1","192.169.0.1","100.63.0.1","100.128.0.1","169.253.0.1","11.0.0.1"]){
      expect(isNonPublicHost(ip),ip).toBe(false);
    }
  });
  it("sees through the numeric spellings the URL parser normalises",()=>{
    for(const url of ["http://2130706433/","http://0x7f.0.0.1/","http://127.1/","http://017700000001/","http://[::1]/","http://[::ffff:127.0.0.1]/","http://[fe80::1]/","http://[fd00::1]/"]){
      expect(isNonPublicHost(host(url)),url).toBe(true);
    }
  });
  it("accepts global-unicast IPv6 and ordinary public names",()=>{
    expect(isNonPublicHost(host("https://[2606:4700:4700::1111]/"))).toBe(false);
    for(const name of ["api.example.com","quotes.example.org","email.provider.io"])expect(isNonPublicHost(name),name).toBe(false);
  });
  it("flags single-label and internal-looking names",()=>{
    for(const name of ["localhost","LOCALHOST","db","metadata","app.localhost","svc.internal","printer.local","host.lan","x.home.arpa","localhost."])expect(isNonPublicHost(name),name).toBe(true);
  });
});

describe("endpoint settings that carry a token",()=>{
  it("pairs each address with its token",()=>{
    expect(ENDPOINT_SECRET_PAIRS).toEqual({EMAIL_HTTP_ENDPOINT:"EMAIL_HTTP_TOKEN",MARKET_DATA_HTTP_BASE_URL:"MARKET_DATA_HTTP_TOKEN"});
    for(const [endpoint,token] of Object.entries(ENDPOINT_SECRET_PAIRS)){
      expect(def(endpoint).kind).toBe("url");
      expect(def(endpoint).publicHostOnly).toBe(true);
      expect(def(token).kind).toBe("secret");
    }
  });

  it("refuses local and private addresses in production",()=>{
    vi.stubEnv("NODE_ENV","production");
    for(const key of Object.keys(ENDPOINT_SECRET_PAIRS)){
      for(const bad of ["http://localhost:8080","http://127.0.0.1","https://127.0.0.1","https://10.1.2.3","https://169.254.169.254/latest","https://[::1]","https://db","https://svc.internal","https://192.168.0.10:9000"]){
        expect(validateSetting(def(key),bad).ok,key+" "+bad).toBe(false);
      }
      expect(validateSetting(def(key),"https://api.example.com/")).toEqual({ok:true,value:"https://api.example.com"});
    }
  });

  it("still accepts a local service outside production, so development keeps working",()=>{
    vi.stubEnv("NODE_ENV","test");
    expect(validateSetting(def("EMAIL_HTTP_ENDPOINT"),"http://127.0.0.1:8025").ok).toBe(true);
    expect(validateSetting(def("MARKET_DATA_HTTP_BASE_URL"),"http://localhost:9000").ok).toBe(true);
  });

  it("does not restrict other url settings",()=>{
    vi.stubEnv("NODE_ENV","production");
    expect(validateSetting(def("NEXT_PUBLIC_APP_URL"),"http://127.0.0.1:3000").ok).toBe(true);
  });

  it("withdraws the token inside the same transaction as an address change and audits the key only",()=>{
    const source=readFileSync(new URL("../src/lib/settings.ts",import.meta.url),"utf8");
    expect(source).toContain("ENDPOINT_SECRET_PAIRS");
    expect(source).toContain("settings.endpoint-changed");
    const begin=source.indexOf("sql.begin(");
    expect(source.indexOf("ENDPOINT_SECRET_PAIRS[change.key]")).toBeGreaterThan(begin);
    // The audit metadata carries key names, never values.
    const audit=source.slice(source.indexOf("settings.endpoint-changed"));
    expect(audit.slice(0,300)).toContain("JSON.stringify({ key: item.key, secretCleared:");
  });
});
