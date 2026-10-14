import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
const read=(path:string)=>readFileSync(path,"utf8");

describe("Admin individual customer workflow",()=>{
 it("requires Admin permissions and a validated UUID before reading customer state",()=>{
  const page=read("src/app/admin/users/[id]/page.tsx");
  expect(page).toContain("await requireAdminPage()");
  expect(page).toContain("z.string().uuid().safeParse(id)");
  expect(page).toContain("if(!user)notFound()");
  expect(page).toContain("deleted_at IS NULL");
  expect(page).toContain("WHERE id=$1::uuid");
  expect(page).toContain("WHERE s.user_id=$1::uuid");
  expect(page).toContain("WHERE a.user_id=$1::uuid");
  expect(page).toContain("WHERE user_id=$1::uuid");
  expect(page).toContain("key={String(user.id)}");
 });
 it("reuses audited and entitlement-enforced access controls without new mutation routes",()=>{
  const page=read("src/app/admin/users/[id]/page.tsx");
  const api=read("src/app/api/admin/user-strategy-access/route.ts");
  expect(page).toContain("<UserStrategyAccessEditor");
  expect(page).toContain("initialOverrides={overrides.map");
  expect(api).toContain("await requireAdmin()");
  expect(api).toContain("assertSameOrigin(request)");
  expect(api).toContain("user.strategy-access.changed");
  expect(api).toContain("enforceStrategyEntitlements(userId)");
 });
 it("links both lookup results and recent-directory records to the account detail",()=>{
  const route=read("src/app/api/admin/users/lookup/route.ts");
  const lookup=read("src/components/AdminCustomerLookup.tsx");
  const directory=read("src/components/AdminCustomersTable.tsx");
  const index=read("src/app/admin/users/page.tsx");
  expect(route).toContain("SELECT u.id,u.email");
  expect(route).toContain("id:String(r.id)");
  expect(lookup).toContain('href={"/admin/users/"+row.id}');
  expect(directory).toContain('href={"/admin/users/"+user.id}');
  expect(index).toContain("id:String(u.id)");
  const commerce=read("src/app/admin/plans/page.tsx");
  expect(commerce).toContain("SELECT u.id AS user_id,u.email");
  expect(commerce).toContain('href={"/admin/users/"+String(s.user_id)}');
 });
 it("does not read financial ledger, raw billing exceptions, Stripe identifiers or encrypted secrets",()=>{
  const page=read("src/app/admin/users/[id]/page.tsx");
  for(const forbidden of ["ledger_events","stripe_customer_id","stripe_subscription_id",
   "password_hash","mfa_secret_encrypted","billing_check_error AS", "SELECT *"]){
   expect(page).not.toContain(forbidden);
  }
  expect(page).toContain("(s.billing_check_error IS NOT NULL) AS sync_error");
  expect(page).toContain("Recorded subscription");
  expect(page).toContain("does not collect payments, issue refunds");
 });
});
