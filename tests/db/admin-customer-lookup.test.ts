import {afterAll,beforeAll,describe,expect,it} from "vitest";
import postgres from "postgres";

const url=process.env.DATABASE_URL;
const sql=url?postgres(url,{max:1,prepare:false}):null;
const suffix=Math.random().toString(36).slice(2,11);
const prefix="admin-lookup-"+suffix;
const emails=[prefix+"-alpha@example.test",prefix+"-beta@example.test",prefix+"-gone@example.test"];

describe.skipIf(!url)("full-database customer search SQL",()=>{
 beforeAll(async()=>{
  for(const email of emails)
   await sql!.unsafe("INSERT INTO users (email,password_hash) VALUES ($1,'x')",[email]);
  await sql!.unsafe("UPDATE users SET deleted_at=now() WHERE email=$1",[emails[2]]);
 });
 afterAll(async()=>{
  if(!sql)return;
  await sql.unsafe("DELETE FROM users WHERE email=ANY($1::text[])",[emails]);
  await sql.end();
 });
 it("is case-insensitive and excludes soft-deleted customers",async()=>{
  const count=await sql!.unsafe(
   "SELECT count(*)::int AS c FROM users u WHERE u.deleted_at IS NULL AND strpos(lower(u.email),lower($1::text))>0",
   [prefix.toUpperCase()]
  );
  expect(Number(count[0]?.c)).toBe(2);
  const result=await sql!.unsafe(
   "SELECT u.email FROM users u WHERE u.deleted_at IS NULL AND strpos(lower(u.email),lower($1::text))>0 "+
   "ORDER BY u.created_at DESC,u.id DESC LIMIT $2 OFFSET $3",[prefix,25,0]
  );
  expect(new Set(result.map(row=>String(row.email)))).toEqual(new Set(emails.slice(0,2)));
 });
 it("treats SQL wildcard characters and injection-like text as literal substrings",async()=>{
  for(const q of ["%",prefix+"' OR TRUE --"]){
   const rows=await sql!.unsafe(
    "SELECT u.email FROM users u WHERE u.deleted_at IS NULL AND strpos(lower(u.email),lower($1::text))>0",
    [q]
   );
   // Other fixture rows may contain '%', but our unique test addresses never do.
   expect(rows.some(row=>emails.includes(String(row.email)))).toBe(false);
  }
 });
});
