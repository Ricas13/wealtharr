import {afterAll,beforeAll,describe,expect,it} from "vitest";
import postgres from "postgres";

const url=process.env.DATABASE_URL;
const sql=url?postgres(url,{max:1,prepare:false}):null;
const created:string[]=[];
const suffix=Math.random().toString(36).slice(2,11);

describe.skipIf(!url)("Admin individual customer lookup SQL",()=>{
 beforeAll(async()=>{
  for(const label of ["active","deleted"]){
   const row=await sql!.unsafe(
    "INSERT INTO users (email,password_hash) VALUES ($1,'x') RETURNING id",
    ["admin-profile-"+suffix+"-"+label+"@example.test"]
   );
   created.push(String(row[0].id));
  }
  await sql!.unsafe("UPDATE users SET deleted_at=now() WHERE id=$1::uuid",[created[1]]);
 });
 afterAll(async()=>{
  if(!sql)return;
  for(const id of created)await sql.unsafe("DELETE FROM users WHERE id=$1::uuid",[id]);
  await sql.end();
 });
 it("fetches only the exact existing, undeleted account",async()=>{
  const query="SELECT id,email,country,role,created_at FROM users WHERE id=$1::uuid AND deleted_at IS NULL LIMIT 1";
  const own=await sql!.unsafe(query,[created[0]]);
  expect(own).toHaveLength(1);
  expect(String(own[0].id)).toBe(created[0]);
  expect(Object.keys(own[0]).sort()).toEqual(["country","created_at","email","id","role"]);
  expect(await sql!.unsafe(query,[created[1]])).toHaveLength(0);
 });
 it("isolates subscription, strategy summary and access overrides to this account",async()=>{
  const subscription=await sql!.unsafe(
   "SELECT p.display_name AS plan,s.status,s.source,s.cadence,s.cancel_at_period_end,s.current_period_end,s.billing_checked_at,"+
   "(s.billing_check_error IS NOT NULL) AS sync_error FROM subscriptions s "+
   "LEFT JOIN plans p ON p.id=s.plan_id WHERE s.user_id=$1::uuid LIMIT 1",
   [created[0]]
  );
  expect(subscription.length).toBeLessThanOrEqual(1);
  const activity=await sql!.unsafe(
   "SELECT count(*) FILTER (WHERE status='ACTIVE')::int AS active,"+
   "count(*) FILTER (WHERE status='ACTIVE' AND health_status<>'HEALTHY')::int AS attention "+
   "FROM strategy_instances WHERE user_id=$1::uuid",[created[0]]
  );
  expect(Number(activity[0]?.active)).toBe(0);
  const permissions=await sql!.unsafe(
   "SELECT d.key,a.allowed FROM user_strategy_access a JOIN strategy_definitions d "+
   "ON d.id=a.strategy_definition_id WHERE a.user_id=$1::uuid ORDER BY d.name",
   [created[0]]
  );
  expect(permissions).toHaveLength(0);
 });
});
