import {describe,expect,it} from "vitest";
import {execFileSync,spawnSync} from "node:child_process";
import {readFileSync} from "node:fs";
import postgres from "postgres";

describe("restore drill script",()=>{
 it("is valid shell",()=>{
  expect(()=>execFileSync("sh",["-n","scripts/restore-drill.sh"])).not.toThrow();
 });
 it("refuses to restore over the live database",()=>{
  const result=spawnSync("sh",["scripts/restore-drill.sh"],{encoding:"utf8",env:{...process.env,PGHOST:"x",PGUSER:"x",PGPASSWORD:"x",PGDATABASE:"live",DRILL_SCRATCH_DB:"live",DRILL_DUMP_FILE:"/dev/null"}});
  expect(result.status).toBe(2);
  expect(result.stderr).toMatch(/must not be the live database/);
 });
 it("keeps its safety rails in the source",()=>{
  const source=readFileSync("scripts/restore-drill.sh","utf8");
  expect(source).toContain("DROP DATABASE IF EXISTS");
  expect(source).toContain("--exit-on-error");
  expect(source).not.toMatch(/DROP DATABASE[^\n]*\$PGDATABASE/);
 });
 it("stops when the scratch-database existence check cannot reach PostgreSQL",()=>{
  const result=spawnSync("sh",["-c","psql() { return 71; }; . scripts/restore-drill.sh"],{
   encoding:"utf8",env:{...process.env,PGHOST:"unreachable",PGUSER:"test",PGPASSWORD:"test",PGDATABASE:"live",DRILL_SCRATCH_DB:"scratch",DRILL_DUMP_FILE:"/dev/null"}
  });
  // The exact failed query exit code must propagate, before checking the dump,
  // creating a directory/database or attempting a restore.
  expect(result.status).toBe(71);
  expect(result.stderr).not.toContain("Backup file is empty");
 });
});

describe.skipIf(!process.env.DATABASE_URL)("restore drill against a real server",()=>{
 const url=new URL(process.env.DATABASE_URL??"postgresql://x@localhost/x");
 const pg={PGHOST:url.hostname,PGPORT:url.port||"5432",PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:url.pathname.slice(1)};
 it("never drops a database it did not create, even when told to use it as the scratch database",async()=>{
  const sql=postgres(process.env.DATABASE_URL!,{max:1});
  try{
   await sql.unsafe("CREATE DATABASE restore_drill_guard");
   // The scratch name is an existing database that is not the live one: it must survive the refusal.
   const result=spawnSync("sh",["scripts/restore-drill.sh"],{encoding:"utf8",env:{...process.env,...pg,DRILL_SCRATCH_DB:"restore_drill_guard",DRILL_DUMP_FILE:"/dev/null"}});
   expect(result.status).toBe(2);
   expect(result.stderr).toMatch(/already exists/);
   const still=await sql.unsafe("SELECT 1 FROM pg_database WHERE datname='restore_drill_guard'");
   expect(still).toHaveLength(1);
   // And the live database survives the "scratch is the live database" refusal too.
   const live=spawnSync("sh",["scripts/restore-drill.sh"],{encoding:"utf8",env:{...process.env,...pg,DRILL_SCRATCH_DB:pg.PGDATABASE,DRILL_DUMP_FILE:"/dev/null"}});
   expect(live.status).toBe(2);
   expect(await sql.unsafe("SELECT 1 FROM pg_database WHERE datname=current_database()")).toHaveLength(1);
  }finally{
   await sql.unsafe("DROP DATABASE IF EXISTS restore_drill_guard");
   await sql.end();
  }
 });
});
