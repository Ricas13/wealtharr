import { describe,expect,it } from "vitest";
import { newAccountIsInvited } from "../src/domain/beta-invites";

describe("invite-only private beta gate",()=>{
  const restricted={WEALTHARR_PRIVATE_BETA_INVITE_ONLY:"true",WEALTHARR_BETA_INVITE_EMAILS:"invited@example.test, second@example.test"};
  it("does not restrict enrolment when invitation mode is explicitly disabled",()=>{
    expect(newAccountIsInvited("anyone@example.test",{})).toBe(true);
    expect(newAccountIsInvited("anyone@example.test",{WEALTHARR_PRIVATE_BETA_INVITE_ONLY:"false"})).toBe(true);
  });
  it("matches only the exact invited address, case-insensitively",()=>{
    expect(newAccountIsInvited(" INVITED@EXAMPLE.TEST ",restricted)).toBe(true);
    expect(newAccountIsInvited("second@example.test",restricted)).toBe(true);
    expect(newAccountIsInvited("uninvited@example.test",restricted)).toBe(false);
    expect(newAccountIsInvited("other@invited.example.test",restricted)).toBe(false);
    expect(newAccountIsInvited("",restricted)).toBe(false);
  });
  it("fails closed if invite mode is enabled without valid invite addresses",()=>{
    expect(newAccountIsInvited("anyone@example.test",{WEALTHARR_PRIVATE_BETA_INVITE_ONLY:"true"})).toBe(false);
    expect(newAccountIsInvited("anyone@example.test",{WEALTHARR_PRIVATE_BETA_INVITE_ONLY:"true",WEALTHARR_BETA_INVITE_EMAILS:""})).toBe(false);
  });
});
