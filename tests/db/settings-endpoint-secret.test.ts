import { afterAll,beforeAll,describe,expect,it } from "vitest";
import postgres from "postgres";
import { decryptSecret } from "@/lib/crypto";

const url=process.env.DATABASE_URL;
const sql=url?postgres(url,{max:2,prepare:false}):null;
const KEYS=["EMAIL_HTTP_ENDPOINT","EMAIL_HTTP_TOKEN","MARKET_DATA_HTTP_BASE_URL","MARKET_DATA_HTTP_TOKEN"];

// A saved bearer token only goes to the address it was saved with. Real saveSettings, real database.
describe.skipIf(!url)("endpoint and token pairing",()=>{
  const run=Math.random().toString(36).slice(2,10);
  const saved:Record<string,string|undefined>={};
  let adminId="";

  const stored=async(key:string)=>{
    const rows=await sql!.unsafe("SELECT value_encrypted FROM app_settings WHERE key=$1",[key]);
    return rows[0]?decryptSecret(String(rows[0].value_encrypted)):undefined;
  };

  beforeAll(async()=>{
    for(const k of KEYS){saved[k]=process.env[k];delete process.env[k];}
    process.env.APP_ENCRYPTION_KEY??="MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=";
    await sql!.unsafe("DELETE FROM app_settings WHERE key=ANY($1::text[])",[KEYS]);
    const rows=await sql!.unsafe("INSERT INTO users (email,password_hash,role) VALUES ($1,'x','ADMIN') RETURNING id",[`pairing-${run}@example.test`]);
    adminId=String(rows[0].id);
  });
  afterAll(async()=>{
    for(const k of KEYS){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}
    if(!sql)return;
    await sql.unsafe("DELETE FROM app_settings WHERE key=ANY($1::text[])",[KEYS]);
    await sql.unsafe("DELETE FROM audit_events WHERE actor_user_id=$1",[adminId]);
    await sql.unsafe("DELETE FROM users WHERE id=$1",[adminId]);
    await sql.end();
  });

  it("keeps a token saved with its address",async()=>{
    const { saveSettings }=await import("@/lib/settings");
    const result=await saveSettings(adminId,[{key:"EMAIL_HTTP_ENDPOINT",value:"https://mail.one.example"},{key:"EMAIL_HTTP_TOKEN",value:"tok-"+run+"-one"}]);
    expect(result.ok).toBe(true);
    expect(await stored("EMAIL_HTTP_TOKEN")).toBe("tok-"+run+"-one");
  });

  it("does not touch the token when the address is saved unchanged",async()=>{
    const { saveSettings }=await import("@/lib/settings");
    const result=await saveSettings(adminId,[{key:"EMAIL_HTTP_ENDPOINT",value:"https://mail.one.example/"}]);
    expect(result).toMatchObject({ok:true,changed:["EMAIL_HTTP_ENDPOINT"]});
    expect(await stored("EMAIL_HTTP_TOKEN")).toBe("tok-"+run+"-one");
  });

  it("withdraws the token when only the address changes, and says so without values",async()=>{
    const { saveSettings }=await import("@/lib/settings");
    const result=await saveSettings(adminId,[{key:"EMAIL_HTTP_ENDPOINT",value:"https://mail.two.example"}]);
    expect(result).toMatchObject({ok:true});
    if(result.ok)expect(result.changed).toEqual(expect.arrayContaining(["EMAIL_HTTP_ENDPOINT","EMAIL_HTTP_TOKEN"]));
    expect(await stored("EMAIL_HTTP_TOKEN")).toBeUndefined();
    expect(await stored("EMAIL_HTTP_ENDPOINT")).toBe("https://mail.two.example");
    expect(process.env.EMAIL_HTTP_TOKEN??"").toBe("");
    const events=await sql!.unsafe("SELECT metadata FROM audit_events WHERE actor_user_id=$1 AND action='settings.endpoint-changed' ORDER BY occurred_at DESC",[adminId]);
    expect(events[0].metadata).toEqual({key:"EMAIL_HTTP_ENDPOINT",secretCleared:"EMAIL_HTTP_TOKEN"});
    expect(JSON.stringify(events.map((e)=>e.metadata))).not.toContain("mail.two.example");
  });

  it("accepts a new token supplied in the same save as the new address",async()=>{
    const { saveSettings }=await import("@/lib/settings");
    await saveSettings(adminId,[{key:"MARKET_DATA_HTTP_BASE_URL",value:"https://quotes.one.example"},{key:"MARKET_DATA_HTTP_TOKEN",value:"qt-"+run+"-one"}]);
    const result=await saveSettings(adminId,[{key:"MARKET_DATA_HTTP_BASE_URL",value:"https://quotes.two.example"},{key:"MARKET_DATA_HTTP_TOKEN",value:"qt-"+run+"-two"}]);
    expect(result.ok).toBe(true);
    expect(await stored("MARKET_DATA_HTTP_TOKEN")).toBe("qt-"+run+"-two");
  });

  it("withdraws the token when the address is cleared",async()=>{
    const { saveSettings }=await import("@/lib/settings");
    const result=await saveSettings(adminId,[{key:"MARKET_DATA_HTTP_BASE_URL",value:null}]);
    expect(result.ok).toBe(true);
    expect(await stored("MARKET_DATA_HTTP_BASE_URL")).toBeUndefined();
    expect(await stored("MARKET_DATA_HTTP_TOKEN")).toBeUndefined();
  });
});
