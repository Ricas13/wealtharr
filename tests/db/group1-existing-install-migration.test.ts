import {readFileSync} from "node:fs";
import postgres from "postgres";
import {describe,expect,it} from "vitest";
import {getStrategyPlugin} from "@/domain/strategy/catalog";

/**
 * Exercises the actual existing-install migration inside a rollback-only transaction.
 * CI's disposable fixture begins with historical 1.0 DRAFT/PUBLISHED releases. Neither a
 * version's immutable config nor existing customer assignments are rewritten by the upgrade.
 */
const url=process.env.DATABASE_URL;
const sql=url?postgres(url,{max:1,prepare:false}):null;
const keys=["80-20","three-fund","golden-butterfly","permanent-portfolio","buffett-90-10"] as const;
const migration=readFileSync("db/migrations/0058_group1_fixed_allocation_versions.sql","utf8");

describe.skipIf(!sql)("Group 1 existing-install release migration",()=>{
  it("publishes a new 1.1 version, retaining exact 1.0 release state and configuration",async()=>{
    await expect(sql!.begin(async tx=>{
      for(const key of keys){
        const rows=await tx.unsafe(
          "SELECT v.id,v.version,v.lifecycle_status,v.config FROM strategy_versions v "+
          "JOIN strategy_definitions d ON d.id=v.strategy_definition_id WHERE d.key=$1 AND v.version='1.0'",[key]);
        expect(rows,key+" requires a 1.0 fixture").toHaveLength(1);
        expect(rows[0].version).toBe("1.0");
      }
      const historical=await tx.unsafe(
        "SELECT d.key,v.id,v.lifecycle_status,v.config FROM strategy_versions v "+
        "JOIN strategy_definitions d ON d.id=v.strategy_definition_id "+
        "WHERE d.key = ANY($1::text[]) AND v.version='1.0'",[keys.join(",").split(",")]);
      const snapshots=new Map(historical.map(r=>[String(r.key),{
        id:String(r.id),lifecycle:String(r.lifecycle_status),config:r.config
      }]));
      // The migration contains only INSERTs, all idempotent and no updates.
      expect(migration).not.toMatch(/\b(?:UPDATE|DELETE|TRUNCATE)\s+(?:strategy_versions|strategy_instances|ledger_events)\b/i);
      await tx.unsafe(migration);
      await tx.unsafe(migration);
      for(const key of keys){
        const versions=await tx.unsafe(
          "SELECT v.id,v.version,v.lifecycle_status,v.config,v.engine_key FROM strategy_versions v "+
          "JOIN strategy_definitions d ON d.id=v.strategy_definition_id "+
          "WHERE d.key=$1 AND v.version IN ('1.0','1.1') ORDER BY v.version",[key]);
        expect(versions,key).toHaveLength(2);
        const before=snapshots.get(key)!;
        expect(String(versions[0].id)).toBe(before.id);
        expect(versions[0].lifecycle_status).toBe(before.lifecycle);
        expect(versions[0].config).toEqual(before.config);
        expect(versions[1].lifecycle_status).toBe("PUBLISHED");
        expect(versions[1].engine_key).toBe("FIXED_ALLOCATION");
        expect(versions[1].config).toEqual(getStrategyPlugin(key)!.profile!.config);
      }
      // A deliberate test exception rolls back all five inserted 1.1 rows.
      throw new Error("GROUP1_TEST_ROLLBACK");
    })).rejects.toThrow("GROUP1_TEST_ROLLBACK");
  });
});

