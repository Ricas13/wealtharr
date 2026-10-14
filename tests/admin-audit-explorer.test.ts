import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {parseAuditFilters,auditPageWindow,auditPageHref,AUDIT_PAGE_SIZE} from "@/domain/admin-audit-explorer";

describe("Admin audit history explorer",()=>{
 it("accepts only non-sensitive action-name patterns and predefined windows",()=>{
  expect(parseAuditFilters({action:"  billing.store-needs-review  ",days:"90",page:"2"}))
   .toEqual({action:"billing.store-needs-review",days:90,page:2,invalidAction:false});
  expect(parseAuditFilters({action:"customer@example.com",days:"1",page:"-9"}))
   .toEqual({action:"",days:30,page:1,invalidAction:true});
  expect(parseAuditFilters({action:"",days:"0",page:"1"}).days).toBe(0);
  expect(parseAuditFilters({action:"x".repeat(65)}).invalidAction).toBe(true);
  expect(parseAuditFilters({action:"a\nb"}).invalidAction).toBe(true);
 });
 it("clamps results and never creates an unbounded page",()=>{
  expect(AUDIT_PAGE_SIZE).toBe(50);
  expect(auditPageWindow(0,100)).toEqual({page:1,pages:1,limit:50,offset:0});
  expect(auditPageWindow(151,2)).toEqual({page:2,pages:4,limit:50,offset:50});
  expect(auditPageWindow(151,999)).toEqual({page:4,pages:4,limit:50,offset:150});
 });
 it("encodes safe operational filters in pagination links",()=>{
  expect(auditPageHref("settings.changed",7,2))
   .toContain("/admin/security/audit?action=settings.changed&days=7&page=2");
 });
 it("requires Admin and parameterised queries without exposing metadata or identity",()=>{
  const page=readFileSync("src/app/admin/security/audit/page.tsx","utf8");
  const index=readFileSync("src/app/admin/security/page.tsx","utf8");
  expect(page).toContain("await requireAdminPage()");
  expect(page).toContain("parseAuditFilters(await searchParams)");
  expect(page).toContain("lower($1::text)");
  expect(page).toContain("$2::int");
  expect(page).toContain("LIMIT $3 OFFSET $4");
  expect(page).not.toContain("SELECT *");
  expect(page).not.toContain("a.metadata");
  expect(page).not.toContain("u.email");
  expect(index).toContain('href="/admin/security/audit"');
 });
});
