import { describe,expect,it } from "vitest";
import { readFileSync } from "node:fs";

describe("notification delivery entitlement safety",()=>{
  const source=readFileSync(new URL("../src/lib/notification-service.ts",import.meta.url),"utf8");

  it("serialises child delivery insertion and processed marker with the parent notification row",()=>{
    const lock=source.indexOf('SELECT id FROM notifications WHERE id=$1 FOR UPDATE');
    const tx=source.indexOf('await sql.begin(async tx=>');
    const insert=source.indexOf('INSERT INTO notification_deliveries');
    const marker=source.indexOf('UPDATE notifications SET deliveries_created_at=now()');
    expect(tx).toBeGreaterThanOrEqual(0);
    expect(lock).toBeGreaterThan(tx);
    expect(insert).toBeGreaterThan(lock);
    expect(marker).toBeGreaterThan(insert);
    expect(source.slice(insert,marker)).toContain('await tx.unsafe');
  });

  it("rechecks the current plan before sending a queued paid-channel delivery",()=>{
    expect(source).toContain("await loadEntitlements(userId)");
    expect(source).toContain("channels.has(String(d.channel))");
    expect(source).toContain("CHANNEL_NOT_IN_PLAN");
    const entitlementCheck=source.indexOf("channels.has(String(d.channel))");
    const emailSend=source.indexOf('if(d.channel==="EMAIL")');
    expect(entitlementCheck).toBeGreaterThanOrEqual(0);
    expect(emailSend).toBeGreaterThan(entitlementCheck);
  });

  it("cancels rather than retries a delivery whose channel is no longer entitled",()=>{
    expect(source).toContain("status='CANCELLED'");
    expect(source).toContain("last_error_code='CHANNEL_NOT_IN_PLAN'");
  });

  it("cancels queued action notifications after the action stops being executable",()=>{
    expect(source).toContain("ACTION_NO_LONGER_ACTIVE");
    // The live statuses come from one shared definition, which must still be exactly these three.
    expect(source).toContain('!isExecutableActionStatus(String(d.action_status??""))');
    const actions=readFileSync(new URL("../src/domain/actions.ts",import.meta.url),"utf8");
    expect(actions).toContain('EXECUTABLE_ACTION_STATUSES=["CALCULATED","NOTIFIED","ACKNOWLEDGED"]');
    const actionCheck=source.indexOf('!isExecutableActionStatus(String(d.action_status??""))');
    const emailSend=source.indexOf('if(d.channel==="EMAIL")');
    expect(actionCheck).toBeGreaterThanOrEqual(0);
    expect(emailSend).toBeGreaterThan(actionCheck);
  });

  it("suppresses older queued notifications when the same action is reactivated",()=>{
    expect(source).toContain("SUPERSEDED_ACTION_NOTIFICATION");
    expect(source).toContain("latest_action_notification");
    const latestCheck=source.indexOf("latest_action_notification");
    const emailSend=source.indexOf('if(d.channel==="EMAIL")');
    expect(latestCheck).toBeGreaterThanOrEqual(0);
    expect(emailSend).toBeGreaterThan(latestCheck);
  });

  it("caps attempts in the claim and only lets provider failures trip the channel breaker",()=>{
    expect(source).toContain("attempt_count<$2");
    expect(source).toContain("[limit,DELIVERY_MAX_ATTEMPTS]");
    // A failed revalidation (failureCode still ACTION_REVALIDATION_FAILED) must not count.
    expect(source).toContain('if(failureCode==="DELIVERY_FAILED"){');
    const breaker=source.indexOf("CHANNEL_BREAKER_FAILURES)tripped.add");
    expect(breaker).toBeGreaterThan(source.indexOf('if(failureCode==="DELIVERY_FAILED"){'));
  });
});
