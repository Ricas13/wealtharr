import {afterAll,beforeAll,describe,expect,it} from "vitest";
import postgres from "postgres";

const url=process.env.DATABASE_URL;
const sql=url?postgres(url,{max:1,prepare:false}):null;
const action="admin.audit-explorer."+Math.random().toString(36).slice(2,12);
const conditions=" WHERE ($1::text='' OR strpos(lower(a.action),lower($1::text))>0)"+
 " AND ($2::int=0 OR a.occurred_at>=now()-($2::int * interval '1 day'))";

describe.skipIf(!url)("audited action history SQL",()=>{
 beforeAll(async()=>{
  await sql!.unsafe("INSERT INTO audit_events(action,entity_type,occurred_at) VALUES ($1,'test',now())",[action]);
  await sql!.unsafe("INSERT INTO audit_events(action,entity_type,occurred_at) VALUES ($1,'test',now()-interval '40 days')",[action]);
 });
 afterAll(async()=>{
  if(!sql)return;
  await sql.unsafe("DELETE FROM audit_events WHERE action=$1",[action]);
  await sql.end();
 });
 it("filters by safely bound action and retains date-window semantics",async()=>{
  const last30=await sql!.unsafe("SELECT count(*)::int AS c FROM audit_events a"+conditions,[action.toUpperCase(),30]);
  const all=await sql!.unsafe("SELECT count(*)::int AS c FROM audit_events a"+conditions,[action,0]);
  expect(Number(last30[0]?.c)).toBe(1);
  expect(Number(all[0]?.c)).toBe(2);
 });
 it("fetches only safe fields with deterministic pagination",async()=>{
  const rows=await sql!.unsafe(
   "SELECT a.action,a.entity_type,a.occurred_at FROM audit_events a"+conditions+
   " ORDER BY a.occurred_at DESC,a.id DESC LIMIT $3 OFFSET $4",
   [action,0,1,1]
  );
  expect(rows).toHaveLength(1);
  expect(Object.keys(rows[0]).sort()).toEqual(["action","entity_type","occurred_at"]);
 });
});
