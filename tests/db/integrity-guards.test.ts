import { afterAll,beforeAll,describe,expect,it } from "vitest";
import postgres from "postgres";

// Migrations 0038 (integrity guards) and 0039 (vocabulary checks), exercised against a real database.
const url=process.env.DATABASE_URL;
const sql=url?postgres(url,{max:1,prepare:false}):null;
const CONFIG=JSON.stringify({targetExposure:"NASDAQ_100_3X_LONG",targetRate:"0.09"});

describe.skipIf(!url)("database integrity guards",()=>{
  const run=Math.random().toString(36).slice(2,10);
  const userIds:string[]=[];
  let definitionId="";
  let seq=0;

  async function user(label:string,role="USER",email?:string){
    const rows=await sql!.unsafe("INSERT INTO users (email,password_hash,role) VALUES ($1,'x',$2) RETURNING id",[email??`ig-${label}-${run}@example.test`,role]);
    userIds.push(String(rows[0].id));
    return String(rows[0].id);
  }
  async function version(target:"DRAFT"|"PUBLISHED"="DRAFT"){
    seq+=1;
    // Inserted as DRAFT then promoted, as the API does, so the guard sees a real lifecycle move.
    const rows=await sql!.unsafe(
      "INSERT INTO strategy_versions (strategy_definition_id,version,effective_from,engine_key,lifecycle_status,input_schema,config,disclosure) VALUES ($1,$2,$3,'VALUE_TARGET','DRAFT','[]'::jsonb,$4::text::jsonb,'original disclosure') RETURNING id",
      [definitionId,"ig-"+seq,"20"+(40+seq)+"-01-01",CONFIG]
    );
    const id=String(rows[0].id);
    if(target==="PUBLISHED")await sql!.unsafe("UPDATE strategy_versions SET lifecycle_status='PUBLISHED',published_at=now() WHERE id=$1",[id]);
    return id;
  }
  const status=async(id:string)=>String((await sql!.unsafe("SELECT lifecycle_status FROM strategy_versions WHERE id=$1",[id]))[0].lifecycle_status);

  beforeAll(async()=>{
    const defs=await sql!.unsafe("INSERT INTO strategy_definitions (key,name,family,engine,enabled) VALUES ($1,'Integrity test','SIGNAL_VALUE_TARGET','VALUE_TARGET',false) RETURNING id",["integrity-"+run]);
    definitionId=String(defs[0].id);
  });
  afterAll(async()=>{
    if(!sql)return;
    await sql.unsafe("DELETE FROM users WHERE id=ANY($1::uuid[])",[userIds]);
    await sql.end();
    // Maintenance cleanup uses its own connection so the opt-in flag never leaks into the assertions above.
    const maintenance=postgres(url!,{max:1,prepare:false});
    try{
      await maintenance.unsafe("SET app.allow_published_edit = 'on'");
      await maintenance.unsafe("DELETE FROM canonical_model_performance WHERE strategy_version_id IN (SELECT id FROM strategy_versions WHERE strategy_definition_id=$1)",[definitionId]);
      await maintenance.unsafe("DELETE FROM strategy_versions WHERE strategy_definition_id=$1",[definitionId]);
      await maintenance.unsafe("DELETE FROM strategy_definitions WHERE id=$1",[definitionId]);
    }finally{await maintenance.end();}
  });

  describe("published version immutability",()=>{
    it("allows every edit while the version is a draft",async()=>{
      const id=await version();
      await expect(sql!.unsafe("UPDATE strategy_versions SET config=$2::text::jsonb,disclosure='changed' WHERE id=$1",[id,JSON.stringify({targetRate:"0.5"})])).resolves.toBeDefined();
    });

    it("refuses rule, disclosure and engine edits on a published version",async()=>{
      const id=await version("PUBLISHED");
      await expect(sql!.unsafe("UPDATE strategy_versions SET config=$2::text::jsonb WHERE id=$1",[id,JSON.stringify({targetRate:"0.99"})])).rejects.toThrow(/PUBLISHED_STRATEGY_VERSION_IS_IMMUTABLE/);
      await expect(sql!.unsafe("UPDATE strategy_versions SET disclosure='rewritten' WHERE id=$1",[id])).rejects.toThrow(/PUBLISHED_STRATEGY_VERSION_IS_IMMUTABLE/);
      await expect(sql!.unsafe("UPDATE strategy_versions SET engine_key='FIXED_ALLOCATION' WHERE id=$1",[id])).rejects.toThrow(/PUBLISHED_STRATEGY_VERSION_IS_IMMUTABLE/);
    });

    it("refuses to move a published version back to draft or to anything else",async()=>{
      const id=await version("PUBLISHED");
      await expect(sql!.unsafe("UPDATE strategy_versions SET lifecycle_status='DRAFT' WHERE id=$1",[id])).rejects.toThrow(/LIFECYCLE_TRANSITION_REFUSED/);
      expect(await status(id)).toBe("PUBLISHED");
    });

    it("allows PUBLISHED to RETIRED and then keeps the retired rules frozen",async()=>{
      const id=await version("PUBLISHED");
      await expect(sql!.unsafe("UPDATE strategy_versions SET lifecycle_status='RETIRED',effective_to=current_date WHERE id=$1",[id])).resolves.toBeDefined();
      expect(await status(id)).toBe("RETIRED");
      await expect(sql!.unsafe("UPDATE strategy_versions SET config=$2::text::jsonb WHERE id=$1",[id,JSON.stringify({targetRate:"0.99"})])).rejects.toThrow(/PUBLISHED_STRATEGY_VERSION_IS_IMMUTABLE/);
      await expect(sql!.unsafe("UPDATE strategy_versions SET lifecycle_status='DRAFT' WHERE id=$1",[id])).rejects.toThrow(/LIFECYCLE_TRANSITION_REFUSED/);
      await expect(sql!.unsafe("UPDATE strategy_versions SET lifecycle_status='PUBLISHED' WHERE id=$1",[id])).rejects.toThrow(/LIFECYCLE_TRANSITION_REFUSED/);
      // Bookkeeping fields remain editable.
      await expect(sql!.unsafe("UPDATE strategy_versions SET release_notes='retired notes',effective_to=current_date WHERE id=$1",[id])).resolves.toBeDefined();
    });

    it("refuses to delete a released version that has a published track record, but not an unused one",async()=>{
      const used=await version("PUBLISHED");
      await sql!.unsafe("INSERT INTO canonical_model_performance (strategy_version_id,date,value) VALUES ($1,current_date,100)",[used]);
      await expect(sql!.unsafe("DELETE FROM strategy_versions WHERE id=$1",[used])).rejects.toThrow(/CANNOT_BE_DELETED/);
      const unused=await version("PUBLISHED");
      await expect(sql!.unsafe("DELETE FROM strategy_versions WHERE id=$1",[unused])).resolves.toBeDefined();
      const draft=await version();
      await expect(sql!.unsafe("DELETE FROM strategy_versions WHERE id=$1",[draft])).resolves.toBeDefined();
    });
  });

  describe("attestation by a deletable admin",()=>{
    it("snapshots the attester's email and survives the account being purged",async()=>{
      const admin=await user("attester","ADMIN");
      const id=await version("PUBLISHED");
      await sql!.unsafe("INSERT INTO strategy_version_attestations (strategy_version_id,spec_card,golden_tests,attested_by) VALUES ($1,'docs/strategy-specs/test-card.md','tests/value-target.test.ts',$2)",[id,admin]);
      const before=(await sql!.unsafe("SELECT attested_by,attested_by_email FROM strategy_version_attestations WHERE strategy_version_id=$1",[id]))[0];
      expect(String(before.attested_by)).toBe(admin);
      expect(before.attested_by_email).toBe(`ig-attester-${run}@example.test`);

      await expect(sql!.unsafe("DELETE FROM users WHERE id=$1",[admin])).resolves.toBeDefined();
      const after=(await sql!.unsafe("SELECT attested_by,attested_by_email FROM strategy_version_attestations WHERE strategy_version_id=$1",[id]))[0];
      expect(after.attested_by).toBeNull();
      expect(after.attested_by_email).toBe(`ig-attester-${run}@example.test`);
    });
  });

  describe("ledger and action references",()=>{
    async function instance(versionId:string){
      const owner=await user("owner"+(++seq));
      const rows=await sql!.unsafe("INSERT INTO strategy_instances (user_id,strategy_definition_id,strategy_version_id,name) VALUES ($1,$2,$3,'integrity') RETURNING id",[owner,definitionId,versionId]);
      return String(rows[0].id);
    }
    const event=async(instanceId:string,type:string,correctionOf:string|null=null)=>String((await sql!.unsafe(
      "INSERT INTO ledger_events (strategy_instance_id,occurred_at,event_type,currency,cash_amount,correction_of_event_id) VALUES ($1,now(),$2,'GBP',10,$3) RETURNING id",
      [instanceId,type,correctionOf]
    ))[0].id);

    it("allows one correction per ledger event and rejects a second",async()=>{
      const instanceId=await instance(await version());
      const original=await event(instanceId,"CONTRIBUTION");
      await expect(event(instanceId,"CORRECTION",original)).resolves.toBeTypeOf("string");
      await expect(event(instanceId,"CORRECTION",original)).rejects.toThrow(/ledger_events_correction_unique|duplicate key/);
    });

    it("rejects a correction that points at no event",async()=>{
      const instanceId=await instance(await version());
      await expect(event(instanceId,"CORRECTION","00000000-0000-4000-8000-000000000000")).rejects.toThrow(/ledger_events_correction_of_event_fk|foreign key/);
    });

    it("rejects an action superseded by a non-existent action",async()=>{
      const versionId=await version();
      const instanceId=await instance(versionId);
      await expect(sql!.unsafe(
        "INSERT INTO actions (strategy_instance_id,strategy_version_id,fingerprint,action_type,title,instruction,superseded_by_action_id) VALUES ($1,$2,'ig-'||$3,'HOLD','t','i','00000000-0000-4000-8000-000000000000')",
        [instanceId,versionId,run]
      )).rejects.toThrow(/actions_superseded_by_action_fk|foreign key/);
    });

    it("has the supporting indexes",async()=>{
      const names=new Set((await sql!.unsafe("SELECT indexname FROM pg_indexes WHERE schemaname=current_schema()")).map((r)=>String(r.indexname)));
      for(const name of ["ledger_events_correction_unique","ledger_events_instrument_idx","actions_newest_idx","users_email_lower_unique"])expect(names.has(name)).toBe(true);
    });
  });

  describe("email uniqueness and vocabulary checks",()=>{
    it("refuses an email that differs only by letter case",async()=>{
      await user("case",`USER`,`Mixed-${run}@Example.test`);
      await expect(user("case2","USER",`mixed-${run}@example.test`)).rejects.toThrow(/users_email_lower_unique|duplicate key/);
    });

    it("rejects values outside the closed vocabularies",async()=>{
      await expect(user("bogus-role","SUPERUSER")).rejects.toThrow(/users_role_vocabulary_check/);
      const id=await version();
      await expect(sql!.unsafe("UPDATE strategy_versions SET lifecycle_status='ARCHIVED' WHERE id=$1",[id])).rejects.toThrow(/strategy_versions_lifecycle_vocabulary_check/);
      const owner=await user("vocab");
      await expect(sql!.unsafe("INSERT INTO strategy_instances (user_id,strategy_definition_id,strategy_version_id,name,status) VALUES ($1,$2,$3,'x','DELETED')",[owner,definitionId,id])).rejects.toThrow(/strategy_instances_status_vocabulary_check/);
      const instanceId=String((await sql!.unsafe("INSERT INTO strategy_instances (user_id,strategy_definition_id,strategy_version_id,name) VALUES ($1,$2,$3,'x') RETURNING id",[owner,definitionId,id]))[0].id);
      await expect(sql!.unsafe("INSERT INTO ledger_events (strategy_instance_id,occurred_at,event_type,currency) VALUES ($1,now(),'GIFT','GBP')",[instanceId])).rejects.toThrow(/ledger_events_event_type_vocabulary_check/);
      await expect(sql!.unsafe("INSERT INTO actions (strategy_instance_id,strategy_version_id,fingerprint,action_type,status,title,instruction) VALUES ($1,$2,'v1-'||$3,'HOLD','BOGUS','t','i')",[instanceId,id,run])).rejects.toThrow(/actions_status_vocabulary_check/);
      await expect(sql!.unsafe("INSERT INTO actions (strategy_instance_id,strategy_version_id,fingerprint,action_type,title,instruction) VALUES ($1,$2,'v2-'||$3,'LIQUIDATE','t','i')",[instanceId,id,run])).rejects.toThrow(/actions_action_type_vocabulary_check/);
    });
  });
});
