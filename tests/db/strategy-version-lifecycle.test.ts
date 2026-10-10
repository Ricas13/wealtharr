import { afterAll,beforeAll,describe,expect,it,vi } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";

// Real admin route, real database. Only the session lookup is replaced.
type SessionUser={id:string;email:string;country:string;baseCurrency:string;timezone:string;role:string;anonymousAggregateOptIn:boolean};
const session=vi.hoisted(()=>({user:null as SessionUser|null}));
vi.mock("@/lib/session",()=>({
  requireUser:async()=>{if(!session.user)throw new Error("UNAUTHENTICATED");return session.user;},
  requireAdmin:async()=>{
    if(!session.user)throw new Error("UNAUTHENTICATED");
    if(session.user.role!=="ADMIN")throw new Error("FORBIDDEN");
    return session.user;
  },
  requirePageUser:async()=>{if(!session.user)throw new Error("UNAUTHENTICATED");return session.user;}
}));

const url=process.env.DATABASE_URL;
const sql=url?postgres(url,{max:6,prepare:false}):null;
const ORIGIN="http://127.0.0.1:3000";
// This test client has no custom serializers: pass JSON text through ::text::jsonb or it is encoded twice.
const CONFIG={targetExposure:"NASDAQ_100_3X_LONG",initialTargetRatio:"0.60",targetRate:"0.09",contributionTargetRatio:"0.50",maxCashUse:"0.90",tolerance:"0.01",reviewFrequency:"QUARTERLY",reviewCutoffLocal:"16:00",businessDayConvention:"PREVIOUS"};

describe.skipIf(!url)("strategy version lifecycle",()=>{
  const run=Math.random().toString(36).slice(2,10);
  const key="lifecycle-"+run;
  let adminId="";
  let definitionId="";

  async function patch(body:unknown){
    const {PATCH}=await import("@/app/api/admin/strategies/route");
    const response=await PATCH(new Request(ORIGIN+"/api/admin/strategies",{method:"PATCH",headers:{origin:ORIGIN,"content-type":"application/json"},body:JSON.stringify(body)}));
    return {status:response.status,json:await response.json() as {error?:string;status?:string}};
  }
  async function draft(version:string,effectiveFrom:string,config:Record<string,unknown>=CONFIG){
    const rows=await sql!.unsafe(
      "INSERT INTO strategy_versions (strategy_definition_id,version,effective_from,engine_key,lifecycle_status,input_schema,config) VALUES ($1,$2,$3,'VALUE_TARGET','DRAFT','[]'::jsonb,$4::text::jsonb) RETURNING id",
      [definitionId,version,effectiveFrom,JSON.stringify(config)]
    );
    await sql!.unsafe("INSERT INTO strategy_version_attestations (strategy_version_id,spec_card,golden_tests,attested_by) VALUES ($1,'docs/strategy-specs/test-card.md','tests/value-target.test.ts',$2)",[rows[0].id,adminId]);
    return String(rows[0].id);
  }
  const row=async(id:string)=>(await sql!.unsafe("SELECT lifecycle_status,config,effective_from::text AS effective_from FROM strategy_versions WHERE id=$1",[id]))[0];

  beforeAll(async()=>{
    process.env.NEXT_PUBLIC_APP_URL=ORIGIN;
    const users=await sql!.unsafe("INSERT INTO users (email,password_hash,role) VALUES ($1,'x','ADMIN') RETURNING id",[`lc-admin-${run}@example.test`]);
    adminId=String(users[0].id);
    session.user={id:adminId,email:`lc-admin-${run}@example.test`,country:"GB",baseCurrency:"GBP",timezone:"Europe/London",role:"ADMIN",anonymousAggregateOptIn:true};
    const defs=await sql!.unsafe(
      "INSERT INTO strategy_definitions (key,name,family,engine,enabled) VALUES ($1,'Lifecycle test','SIGNAL_VALUE_TARGET','VALUE_TARGET',false) RETURNING id",[key]
    );
    definitionId=String(defs[0].id);
  });
  afterAll(async()=>{
    if(!sql)return;
    await sql.unsafe("SET app.allow_published_edit = 'on'");
    // Every definition this run created (including the "-enabled" one), even if a test failed midway.
    await sql.unsafe("DELETE FROM strategy_versions WHERE strategy_definition_id IN (SELECT id FROM strategy_definitions WHERE key LIKE $1)",[key+"%"]);
    await sql.unsafe("DELETE FROM strategy_definitions WHERE key LIKE $1",[key+"%"]);
    await sql.unsafe("DELETE FROM audit_events WHERE actor_user_id=$1",[adminId]);
    await sql.unsafe("DELETE FROM users WHERE id=$1",[adminId]);
    await sql.end();
  });

  it("refuses to publish a version nobody has attested, and accepts it once the sign-off is recorded",async()=>{
    const rows=await sql!.unsafe("INSERT INTO strategy_versions (strategy_definition_id,version,effective_from,engine_key,lifecycle_status,input_schema,config) VALUES ($1,'9.9','2036-01-01','VALUE_TARGET','DRAFT','[]'::jsonb,$2::text::jsonb) RETURNING id",[definitionId,JSON.stringify(CONFIG)]);
    const id=String(rows[0].id);
    const blocked=await patch({action:"PUBLISH",versionId:id});
    expect(blocked.status).toBe(409);
    expect(blocked.json.error).toContain("sign-off");
    expect((await patch({action:"ATTEST",versionId:id,specCard:"../../etc/passwd",goldenTests:"tests/x.test.ts"})).status).toBe(400);
    expect((await patch({action:"ATTEST",versionId:id,specCard:"docs/strategy-specs/example.md",goldenTests:"tests/x.test.ts"})).status).toBe(200);
    expect((await patch({action:"PUBLISH",versionId:id})).status).toBe(200);
    expect((await row(id)).lifecycle_status).toBe("PUBLISHED");
  });

  it("publishes a draft and refuses to publish it twice",async()=>{
    const id=await draft("1.0","2031-01-01");
    expect(await patch({action:"PUBLISH",versionId:id})).toMatchObject({status:200,json:{status:"PUBLISHED"}});
    expect((await row(id)).lifecycle_status).toBe("PUBLISHED");
    expect((await patch({action:"PUBLISH",versionId:id})).status).toBe(409);
  });

  it("invalidates earlier review evidence after editing a draft, then requires re-attestation",async()=>{
    const id=await draft("1.05","2031-01-15");
    const edit=await patch({action:"UPDATE_DRAFT",versionId:id,releaseNotes:"Reviewed text changed"});
    expect(edit.status).toBe(200);
    const attestations=await sql!.unsafe("SELECT strategy_version_id FROM strategy_version_attestations WHERE strategy_version_id=$1",[id]);
    expect(attestations).toHaveLength(0);
    const rejected=await patch({action:"PUBLISH",versionId:id});
    expect(rejected.status).toBe(409);
    expect(rejected.json.error).toContain("sign-off");
    await patch({action:"ATTEST",versionId:id,specCard:"docs/strategy-specs/test-card.md",goldenTests:"tests/value-target.test.ts"});
    expect((await patch({action:"PUBLISH",versionId:id})).status).toBe(200);
  });

  it("database-level draft edits invalidate attestations even when the API is bypassed",async()=>{
    const id=await draft("1.06","2031-01-16");
    const before=await sql!.unsafe("SELECT strategy_version_id FROM strategy_version_attestations WHERE strategy_version_id=$1",[id]);
    expect(before).toHaveLength(1);
    await sql!.unsafe("UPDATE strategy_versions SET release_notes='Research methodology clarified' WHERE id=$1",[id]);
    const after=await sql!.unsafe("SELECT strategy_version_id FROM strategy_version_attestations WHERE strategy_version_id=$1",[id]);
    expect(after).toHaveLength(0);
    expect((await patch({action:"PUBLISH",versionId:id})).status).toBe(409);
    expect((await patch({action:"ATTEST",versionId:id,specCard:"docs/strategy-specs/test-card.md",goldenTests:"tests/value-target.test.ts"})).status).toBe(200);
    expect((await patch({action:"PUBLISH",versionId:id})).status).toBe(200);
    const publishedApproval=await sql!.unsafe("SELECT strategy_version_id FROM strategy_version_attestations WHERE strategy_version_id=$1",[id]);
    expect(publishedApproval).toHaveLength(1);
  });

  it("will not edit a published version through the API",async()=>{
    const id=await draft("1.1","2031-02-01");
    await patch({action:"PUBLISH",versionId:id});
    const attempt=await patch({action:"UPDATE_DRAFT",versionId:id,config:{...CONFIG,targetRate:"0.50"}});
    expect(attempt.status).toBe(409);
    expect((await row(id)).config).toMatchObject({targetRate:"0.09"});
  });

  it("the database itself rejects a rule change on a published version, whatever wrote it",async()=>{
    const id=await draft("1.2","2031-03-01");
    await patch({action:"PUBLISH",versionId:id});
    await expect(sql!.unsafe("UPDATE strategy_versions SET config=$2::text::jsonb WHERE id=$1",[id,JSON.stringify({...CONFIG,targetRate:"0.99"})])).rejects.toThrow(/PUBLISHED_STRATEGY_VERSION_IS_IMMUTABLE/);
    await expect(sql!.unsafe("UPDATE strategy_versions SET effective_from='2031-03-02' WHERE id=$1",[id])).rejects.toThrow(/IMMUTABLE/);
    expect((await row(id)).config).toMatchObject({targetRate:"0.09"});
    // Non-rule fields and lifecycle moves are still allowed.
    await expect(sql!.unsafe("UPDATE strategy_versions SET release_notes='clarified' WHERE id=$1",[id])).resolves.toBeDefined();
  });

  it("allows only one of two operators publishing the same effective date at the same moment",async()=>{
    const first=await draft("2.0-a","2031-06-01");
    const second=await draft("2.0-b","2031-06-01");
    const results=await Promise.all([
      patch({action:"PUBLISH",versionId:first}),
      patch({action:"PUBLISH",versionId:second})
    ]);
    expect(results.map((r)=>r.status).sort()).toEqual([200,409]);
    const published=await sql!.unsafe("SELECT count(*)::int AS n FROM strategy_versions WHERE strategy_definition_id=$1 AND lifecycle_status='PUBLISHED' AND effective_from='2031-06-01'",[definitionId]);
    expect(published[0].n).toBe(1);
  });

  it("serialises an edit racing a publish so the published rules can never change",async()=>{
    for(let attempt=0;attempt<5;attempt+=1){
      const id=await draft("3."+attempt,"2032-0"+(attempt+1)+"-01");
      const [edit,publish]=await Promise.all([
        patch({action:"UPDATE_DRAFT",versionId:id,config:{...CONFIG,targetRate:"0.77"}}),
        patch({action:"PUBLISH",versionId:id})
      ]);
      const stored=await row(id);
      // The editor winning invalidates prior approval, so the concurrent publisher
      // must fail; if publication wins, the editor must refuse to modify published rules.
      if(edit.status===200){
        expect(publish.status).toBe(409);
        expect(stored.lifecycle_status).toBe("DRAFT");
        expect(stored.config).toMatchObject({targetRate:"0.77"});
        const oldApproval=await sql!.unsafe("SELECT 1 FROM strategy_version_attestations WHERE strategy_version_id=$1",[id]);
        expect(oldApproval).toHaveLength(0);
      }else{
        expect(edit.status).toBe(409);
        expect(publish.status).toBe(200);
        expect(stored.lifecycle_status).toBe("PUBLISHED");
        expect(stored.config).toMatchObject({targetRate:"0.09"});
      }
    }
  });

  it("refuses to retire a draft or a version that is already retired",async()=>{
    const id=await draft("4.0","2033-01-01");
    expect((await patch({action:"RETIRE",versionId:id})).status).toBe(409);
    await patch({action:"PUBLISH",versionId:id});
    expect((await patch({action:"RETIRE",versionId:id})).status).toBe(200);
    expect((await patch({action:"RETIRE",versionId:id})).status).toBe(409);
  });

  it("refuses to retire the only published version of an enabled strategy",async()=>{
    const enabled=await sql!.unsafe("INSERT INTO strategy_definitions (key,name,family,engine,enabled) VALUES ($1,'Enabled lifecycle','SIGNAL_VALUE_TARGET','VALUE_TARGET',true) RETURNING id",[key+"-enabled"]);
    const rows=await sql!.unsafe(
      "INSERT INTO strategy_versions (strategy_definition_id,version,effective_from,engine_key,lifecycle_status,input_schema,config) VALUES ($1,'1.0','2031-01-01','VALUE_TARGET','DRAFT','[]'::jsonb,$2::text::jsonb) RETURNING id",
      [enabled[0].id,JSON.stringify(CONFIG)]
    );
    const id=String(rows[0].id);
    await sql!.unsafe("INSERT INTO strategy_version_attestations (strategy_version_id,spec_card,golden_tests,attested_by) VALUES ($1,'docs/strategy-specs/test-card.md','tests/value-target.test.ts',$2)",[id,adminId]);
    await patch({action:"PUBLISH",versionId:id});
    const attempt=await patch({action:"RETIRE",versionId:id});
    expect(attempt.status).toBe(409);
    expect(attempt.json.error).toMatch(/only published version/i);
  });

  it("answers an unknown version with 404",async()=>{
    expect((await patch({action:"PUBLISH",versionId:randomUUID()})).status).toBe(404);
  });
});
