import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {customerLookupInput,customerLookupWindow,CUSTOMER_LOOKUP_PAGE_SIZE} from "@/domain/admin-customer-lookup";

describe("private Admin customer search",()=>{
 it("validates bounded email search and defaults to the first page",()=>{
  expect(customerLookupInput.parse({emailQuery:"  Ada@Example  "}))
   .toEqual({emailQuery:"Ada@Example",page:1});
  expect(customerLookupInput.safeParse({emailQuery:"ab"}).success).toBe(false);
  expect(customerLookupInput.safeParse({emailQuery:"a".repeat(101)}).success).toBe(false);
  expect(customerLookupInput.safeParse({emailQuery:"foo\nbar"}).success).toBe(false);
  expect(customerLookupInput.safeParse({emailQuery:"abc",page:0}).success).toBe(false);
  expect(customerLookupInput.safeParse({emailQuery:"abc",page:10001}).success).toBe(false);
  expect(customerLookupInput.safeParse({emailQuery:"abc",page:1.25}).success).toBe(false);
  expect(customerLookupInput.safeParse({emailQuery:"abc",extra:true}).success).toBe(false);
 });
 it("clamps oversized pages and uses bounded offsets",()=>{
  expect(CUSTOMER_LOOKUP_PAGE_SIZE).toBe(25);
  expect(customerLookupWindow(0,100)).toEqual({page:1,pages:1,offset:0,limit:25});
  expect(customerLookupWindow(51,2)).toEqual({page:2,pages:3,offset:25,limit:25});
  expect(customerLookupWindow(51,10)).toEqual({page:3,pages:3,offset:50,limit:25});
 });
 it("requires admin, same-origin POST, rate limits and parameterised account-only records",()=>{
  const route=readFileSync("src/app/api/admin/users/lookup/route.ts","utf8");
  const page=readFileSync("src/app/admin/users/page.tsx","utf8");
  const client=readFileSync("src/components/AdminCustomerLookup.tsx","utf8");
  for(const required of ["assertSameOrigin(request)","await requireAdmin()","consumeRateLimit","customerLookupInput.parse","u.deleted_at IS NULL","lower($1::text)","LIMIT $2 OFFSET $3","cache-control"]){
   expect(route).toContain(required);
  }
  expect(route).not.toContain("SELECT *");
  expect(route).not.toContain("ledger_events");
  expect(route).not.toContain("stripe_customer_id");
  expect(page).toContain("<AdminCustomerLookup/>");
  expect(client).toContain('method:"POST"');
  expect(client).not.toContain("encodeURIComponent");
 });
});
