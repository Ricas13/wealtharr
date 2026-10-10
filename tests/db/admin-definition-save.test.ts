import {afterAll,describe,expect,it,vi} from "vitest";
import {sql} from "@/lib/db";

const admin=vi.hoisted(()=>({id:""}));
vi.mock("@/lib/session",()=>({requireAdmin:async()=>admin}));

describe.skipIf(!process.env.DATABASE_URL)("admin definition persistence",()=>{
  afterAll(async()=>{
    if(admin.id)await sql.unsafe("DELETE FROM users WHERE id=$1",[admin.id]);
    await sql.end();
  });
  it("saves catalogue metadata against PostgreSQL without bypassing availability controls",async()=>{
    admin.id=String((await sql.unsafe("INSERT INTO users (email,password_hash,role) VALUES ($1,'x','ADMIN') RETURNING id",["definition-"+crypto.randomUUID()+"@example.test"]))[0].id);
    const before=(await sql.unsafe("SELECT * FROM strategy_definitions WHERE key='9sig'"))[0];
    const {PUT}=await import("@/app/api/admin/strategies/route");
    const response=await PUT(new Request("http://127.0.0.1:3000/api/admin/strategies",{
      method:"PUT",headers:{origin:"http://127.0.0.1:3000","content-type":"application/json"},
      body:JSON.stringify({key:before.key,name:before.name,family:before.family,
        description:before.description,engine:before.engine,enabled:!before.enabled,
        proprietary:before.proprietary,defaultBenchmarkKey:before.default_benchmark_key,
        supportedRegions:before.supported_regions,supportedWrappers:before.supported_wrappers,
        requiredInputs:before.required_inputs})
    }));
    expect(response.status).toBe(200);
    const after=(await sql.unsafe("SELECT * FROM strategy_definitions WHERE key='9sig'"))[0];
    expect(after.enabled).toBe(before.enabled);
    expect(after.engine).toBe(before.engine);
    expect(after.required_inputs).toEqual(before.required_inputs);
    expect(await sql.unsafe("SELECT id FROM audit_events WHERE actor_user_id=$1 AND action='strategy-definition.upsert'",[admin.id])).toHaveLength(1);
  });
});
