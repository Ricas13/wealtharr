import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {adminPromotionInput,recentAdminAuth,promotionTargetEligible} from "@/domain/admin-role-promotion";

describe("privileged second-admin promotion",()=>{
 it("requires an exact typed confirmation and a valid existing email",()=>{
  expect(adminPromotionInput.parse({email:"second@example.com",confirmation:"PROMOTE TO ADMIN"}).email).toBe("second@example.com");
  for(const entry of [
   {email:"",confirmation:"PROMOTE TO ADMIN"},
   {email:"not-an-email",confirmation:"PROMOTE TO ADMIN"},
   {email:"second@example.com",confirmation:"promote to admin"},
   {email:"second@example.com",confirmation:"PROMOTE TO ADMIN",role:"ADMIN"}
  ])expect(adminPromotionInput.safeParse(entry).success).toBe(false);
 });
 it("only accepts a recent MFA session, rejecting future and legacy timestamps",()=>{
  const now=1791984000000;
  expect(recentAdminAuth(now-59_999,now)).toBe(true);
  expect(recentAdminAuth(now-600_000,now)).toBe(true);
  expect(recentAdminAuth(now-600_001,now)).toBe(false);
  expect(recentAdminAuth(0,now)).toBe(false);
  expect(recentAdminAuth(now+1,now)).toBe(false);
  expect(recentAdminAuth(Number.NaN,now)).toBe(false);
 });
 it("forbids self/old-admin/unverified/non-MFA and deleted target accounts",()=>{
  const eligible={actorId:"one",targetId:"two",role:"USER",verified:true,mfaEnabled:true,deleted:false};
  expect(promotionTargetEligible(eligible)).toBe(true);
  expect(promotionTargetEligible({...eligible,targetId:"one"})).toBe(false);
  expect(promotionTargetEligible({...eligible,role:"ADMIN"})).toBe(false);
  expect(promotionTargetEligible({...eligible,verified:false})).toBe(false);
  expect(promotionTargetEligible({...eligible,mfaEnabled:false})).toBe(false);
  expect(promotionTargetEligible({...eligible,deleted:true})).toBe(false);
 });
 it("checks identity, MFA and revocation inside the audited transaction",()=>{
  const route=readFileSync("src/app/api/admin/security/promote-admin/route.ts","utf8");
  const page=readFileSync("src/app/admin/security/page.tsx","utf8");
  const notice=readFileSync("src/domain/security-notice.ts","utf8");
  for(const required of ["assertSameOrigin(request)","await requireAdminWithMfa()",
   "recentAdminAuth(actor.authTime,Date.now())","consumeRateLimit",
   "WHERE id=$1::uuid AND role='ADMIN' AND mfa_enabled_at IS NOT NULL",
   "email_verified_at,mfa_enabled_at,deleted_at",
   "promotionTargetEligible","session_version=session_version+1",
   "'admin.role.granted'","notifySecurityEvent(outcome.targetId,\"ADMIN_ROLE_GRANTED\")"
  ])expect(route).toContain(required);
  expect(route).not.toContain("INSERT INTO users");
  expect(route).not.toContain("UPDATE users SET password_hash");
  expect(route).not.toContain("role='USER',");
  expect(page).toContain("<AdminPromotionForm/>");
  expect(page).toContain("WHERE role='ADMIN' AND deleted_at IS NULL");
  expect(notice).toContain("ADMIN_ROLE_GRANTED");
 });
});
