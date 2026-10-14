import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";

describe("Admin Commerce Stripe comparison summary",()=>{
 it("reads only fixed outcome codes and recent counts, never Stripe identifiers or raw provider errors",()=>{
  const page=readFileSync("src/app/admin/plans/page.tsx","utf8");
  const block=page.slice(page.indexOf("comparisonSummary]=await Promise.all"),page.indexOf(" const summary=["));
  expect(block).toContain("action='billing.subscription-compared'");
  expect(block).toContain("interval '7 days'");
  expect(block).toContain("metadata->>'outcome' IN ('MATCH','REVIEW','UNVERIFIED','PROVIDER_UNAVAILABLE','CHECK_UNAVAILABLE')");
  expect(block).toContain("count(*)::int AS c");
  expect(block).toContain("max(occurred_at) AS latest");
  expect(block).not.toContain("metadata->>'customerId'");
  expect(block).not.toContain("stripe_subscription_id");
  expect(page).toContain("Admin-triggered customer checks only");
  expect(page).toContain("Counts reflect operator-triggered attempts, not unique customers");
  expect(page).toContain("/admin/security/audit?action=billing.subscription-compared");
 });
});
