import {describe,expect,it} from "vitest";
import {SETTINGS,SETTING_GROUPS,settingByKey,validateSetting} from "@/domain/settings-registry";

const def=(key:string)=>settingByKey(key)!;
describe("settings registry",()=>{
 it("has unique keys, known groups and help for everything",()=>{
  expect(new Set(SETTINGS.map((s)=>s.key)).size).toBe(SETTINGS.length);
  for(const s of SETTINGS){expect(SETTING_GROUPS as readonly string[],s.key).toContain(s.group);expect(s.help.length,s.key).toBeGreaterThan(10);}
 });
 it("never exposes the bootstrap secrets that must stay outside the database",()=>{
  for(const key of ["DATABASE_URL","AUTH_SECRET","APP_ENCRYPTION_KEY","CRON_SECRET","NODE_ENV","AUTH_URL"])expect(settingByKey(key),key).toBeUndefined();
 });
 it("treats every credential as a secret kind",()=>{
  for(const key of ["STRIPE_SECRET_KEY","STRIPE_WEBHOOK_SECRET","EMAIL_HTTP_TOKEN","MARKET_DATA_HTTP_TOKEN","AUTH_GOOGLE_SECRET","AUTH_APPLE_SECRET","TELEGRAM_BOT_TOKEN","TELEGRAM_WEBHOOK_SECRET"])expect(def(key).kind,key).toBe("secret");
  expect(def("AUTH_APPLE_PRIVATE_KEY").kind).toBe("multiline-secret");
 });
});

describe("validateSetting",()=>{
 it("accepts only explicit booleans",()=>{
  expect(validateSetting(def("ADMIN_MFA_REQUIRED"),"true")).toEqual({ok:true,value:"true"});
  for(const bad of ["yes","1","TRUE",""])expect(validateSetting(def("ADMIN_MFA_REQUIRED"),bad).ok,bad).toBe(false);
 });
 it("checks numbers against their range and whole-number rule",()=>{
  expect(validateSetting(def("CRON_CONCURRENCY"),"8")).toEqual({ok:true,value:"8"});
  for(const bad of ["0","33","2.5","abc","1e3"])expect(validateSetting(def("CRON_CONCURRENCY"),bad).ok,bad).toBe(false);
  expect(validateSetting(def("MARKET_MAX_QUOTE_MOVE"),"0.5").ok).toBe(true);
  expect(validateSetting(def("MARKET_MAX_QUOTE_MOVE"),"9").ok).toBe(false);
 });
 it("requires https addresses without embedded credentials and trims trailing slashes",()=>{
  expect(validateSetting(def("NEXT_PUBLIC_APP_URL"),"https://app.example.com/")).toEqual({ok:true,value:"https://app.example.com"});
  expect(validateSetting(def("NEXT_PUBLIC_APP_URL"),"http://127.0.0.1:3000").ok).toBe(true);
  for(const bad of ["http://app.example.com","ftp://x.test","https://user:pw@x.test","not a url","javascript:alert(1)"])expect(validateSetting(def("NEXT_PUBLIC_APP_URL"),bad).ok,bad).toBe(false);
 });
 it("limits selects to their options",()=>{
  expect(validateSetting(def("EMAIL_PROVIDER"),"http").ok).toBe(true);
  expect(validateSetting(def("EMAIL_PROVIDER"),"smtp").ok).toBe(false);
 });
 it("keeps single-line fields on one line but lets a private key span lines",()=>{
  expect(validateSetting(def("EMAIL_FROM"),"a@b.test\nBcc: x").ok).toBe(false);
  const pem="-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----";
  expect(validateSetting(def("AUTH_APPLE_PRIVATE_KEY"),pem.replace(/\n/g,"\r\n"))).toEqual({ok:true,value:pem});
 });
 it("rejects non-text, empty and oversized values",()=>{
  expect(validateSetting(def("EMAIL_FROM"),42).ok).toBe(false);
  expect(validateSetting(def("EMAIL_FROM"),"   ").ok).toBe(false);
  expect(validateSetting(def("EMAIL_FROM"),"x".repeat(601)).ok).toBe(false);
  expect(validateSetting(def("EMAIL_FROM"),"a\u0000b").ok).toBe(false);
 });
});
