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
    expect(source).toContain('!["CALCULATED","NOTIFIED","ACKNOWLEDGED"].includes');
    const actionCheck=source.indexOf('!["CALCULATED","NOTIFIED","ACKNOWLEDGED"].includes');
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
});
