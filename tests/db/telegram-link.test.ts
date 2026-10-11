import {afterAll,beforeAll,describe,expect,it,vi} from "vitest";
import postgres from "postgres";
import {randomBytes} from "node:crypto";
import {decryptSecret} from "@/lib/crypto";
import {hashTelegramLinkToken} from "@/domain/telegram";
const send=vi.hoisted(()=>({calls:[] as Array<{method:string;payload:Record<string,unknown>}>}));
vi.mock("@/lib/telegram",()=>({telegramCall:async(method:string,payload:Record<string,unknown>)=>{
  send.calls.push({method,payload});return {ok:true};
}}));
const url=process.env.DATABASE_URL;
const sql=url?postgres(url,{max:2,prepare:false}):null;
const secret="S".repeat(48);
describe.skipIf(!url)("Telegram webhook linking against database",()=>{
 const idToken=randomBytes(24).toString("hex");
 const email="tg-"+randomBytes(7).toString("hex")+"@example.test";
 let userId="";
 let route:(r:Request)=>Promise<Response>;
 const base=(token:string,chat=12345678)=>new Request("https://wealtharr.example/api/integrations/telegram/webhook",{
  method:"POST",headers:{"content-type":"application/json","x-telegram-bot-api-secret-token":secret},
  body:JSON.stringify({update_id:123,message:{text:"/start "+token,chat:{id:chat,type:"private"},from:{id:chat}}})
 });
 beforeAll(async()=>{
   process.env.TELEGRAM_WEBHOOK_SECRET=secret;
   process.env.TELEGRAM_BOT_TOKEN="12345678:"+("A".repeat(35));
   process.env.APP_ENCRYPTION_KEY??="MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=";
   const user=(await sql!.unsafe("INSERT INTO users (email,password_hash) VALUES ($1,'x') RETURNING id",[email]))[0];
   userId=String(user.id);
   const pro=await sql!.unsafe("SELECT id FROM plans WHERE slug='pro'");
   await sql!.unsafe("INSERT INTO subscriptions (user_id,plan_id,status,cadence) VALUES ($1,$2,'ACTIVE','MONTHLY')",[userId,pro[0].id]);
   await sql!.unsafe("INSERT INTO telegram_link_tokens (user_id,token_hash,expires_at) VALUES ($1,$2,now()+interval '15 minutes')",[userId,hashTelegramLinkToken(idToken)]);
   route=(await import("@/app/api/integrations/telegram/webhook/route")).POST;
 });
 afterAll(async()=>{if(sql){await sql.unsafe("DELETE FROM users WHERE id=$1",[userId]);await sql.end();}});
 it("denies a forged webhook header without consuming any token",async()=>{
   const forged=base(idToken);
   forged.headers.set("x-telegram-bot-api-secret-token","not-a-valid-secret");
   expect((await route(forged)).status).toBe(401);
   const data=await sql!.unsafe("SELECT used_at FROM telegram_link_tokens WHERE token_hash=$1",[hashTelegramLinkToken(idToken)]);
   expect(data[0].used_at).toBeNull();
 });
 it("rejects a guessed start token without linking anyone",async()=>{
   expect((await route(base("f".repeat(48)))).status).toBe(200);
   const endpoints=await sql!.unsafe("SELECT count(*)::int AS n FROM notification_endpoints WHERE user_id=$1 AND channel='TELEGRAM'",[userId]);
   expect(endpoints[0].n).toBe(0);
 });
 it("links only the matched user to their verified private chat and consumes the code once",async()=>{
   expect((await route(base(idToken))).status).toBe(200);
   const endpoints=await sql!.unsafe("SELECT encrypted_destination FROM notification_endpoints WHERE user_id=$1 AND channel='TELEGRAM'",[userId]);
   expect(endpoints).toHaveLength(1);
   expect(String(endpoints[0].encrypted_destination)).not.toContain("12345678");
   expect(decryptSecret(String(endpoints[0].encrypted_destination))).toBe("12345678");
   expect(send.calls.some(c=>c.method==="sendMessage")).toBe(true);
   expect((await route(base(idToken,99999999))).status).toBe(200);
   const rows=await sql!.unsafe("SELECT encrypted_destination FROM notification_endpoints WHERE user_id=$1 AND channel='TELEGRAM'",[userId]);
   expect(decryptSecret(String(rows[0].encrypted_destination))).toBe("12345678");
 });
});
