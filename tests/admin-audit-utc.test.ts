import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";

describe("Admin operational and security event timestamp consistency",()=>{
 it("shows latest audit events explicitly in UTC rather than the server timezone",()=>{
  const page=readFileSync("src/app/admin/security/page.tsx","utf8");
  expect(page).toContain("When (UTC)");
  expect(page).not.toContain("When (server time)");
  expect(page).toContain('new Date(row.occurred_at).toLocaleString("en-GB",{timeZone:"UTC"})+" UTC"');
 });
 it("uses the same timezone for worker history and billing incident timestamps",()=>{
  const page=readFileSync("src/app/admin/operations/page.tsx","utf8");
  expect(page).toContain('new Date(job.started_at).toLocaleString("en-GB",{timeZone:"UTC"})+" UTC"');
  expect(page).toContain('new Date(item.created_at).toLocaleString("en-GB",{timeZone:"UTC"})');
  expect(page).not.toContain('new Date(job.started_at).toLocaleString("en-GB")');
 });
});
