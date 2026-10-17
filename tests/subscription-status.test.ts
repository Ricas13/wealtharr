import { describe,expect,it } from "vitest";
import { hasLiveStripeSubscription,isTerminalLocalStatus,isTerminalStripeStatus } from "../src/domain/subscription-status";

describe("subscription status helpers",()=>{
  it("treats free, canceled and expired-incomplete local rows as re-purchasable",()=>{
    for(const status of ["FREE","CANCELED","INCOMPLETE_EXPIRED","canceled"])expect(isTerminalLocalStatus(status)).toBe(true);
    for(const status of ["ACTIVE","TRIALING","PAST_DUE","UNPAID","PAUSED","INCOMPLETE"])expect(isTerminalLocalStatus(status)).toBe(false);
  });

  it("recognises dead Stripe subscriptions",()=>{
    expect(isTerminalStripeStatus("canceled")).toBe(true);
    expect(isTerminalStripeStatus("incomplete_expired")).toBe(true);
    expect(isTerminalStripeStatus("active")).toBe(false);
    expect(isTerminalStripeStatus("incomplete")).toBe(false);
  });

  it("detects a customer who is still billed",()=>{
    expect(hasLiveStripeSubscription(["canceled","incomplete_expired"])).toBe(false);
    expect(hasLiveStripeSubscription(["canceled","past_due"])).toBe(true);
    expect(hasLiveStripeSubscription(["trialing"])).toBe(true);
    expect(hasLiveStripeSubscription(["incomplete"])).toBe(true);
    expect(hasLiveStripeSubscription(["paused"])).toBe(true);
    expect(hasLiveStripeSubscription([])).toBe(false);
  });
});
