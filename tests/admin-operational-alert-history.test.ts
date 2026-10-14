import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
describe("admin operational alert history",()=>{
 it("shows read-only persisted incident states with explicit UTC timestamps",()=>{
  const page=readFileSync("src/app/admin/operations/page.tsx","utf8");
  expect(page).toContain("await requireAdminPage()");
  expect(page).toContain("FROM ops_alert_state ORDER BY first_seen_at DESC LIMIT 30");
  expect(page).toContain("first_seen_at,last_notified_at,resolved_at");
  expect(page).toContain('aria-label="Operational alert history"');
  expect(page).toContain('timeZone:"UTC"');
  expect(page).toContain("not independent provider verification");
  expect(page).not.toContain("UPDATE ops_alert_state");
  expect(page).not.toContain("DELETE FROM ops_alert_state");
  expect(page).not.toContain("SELECT * FROM ops_alert_state");
 });
});
