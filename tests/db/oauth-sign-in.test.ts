import { afterAll,describe,expect,it } from "vitest";
import postgres from "postgres";
import bcrypt from "bcryptjs";
import { resolveOAuthSignIn } from "@/lib/oauth";

const url=process.env.DATABASE_URL;
const sql=url?postgres(url,{max:3,prepare:false}):null;

describe.skipIf(!url)("sign in with a provider",()=>{
  const run=Math.random().toString(36).slice(2,10);
  const emails:string[]=[];
  const email=(label:string)=>{const e=`oauth-${label}-${run}@example.test`;emails.push(e);return e;};
  let counter=0;
  const sub=()=>`sub-${run}-${++counter}`;
  const identity=(e:string|null,over:Record<string,unknown>={})=>({provider:"google",providerAccountId:sub(),email:e,emailVerified:true,...over});
  const user=async(e:string)=>(await sql!.unsafe("SELECT * FROM users WHERE lower(email)=lower($1)",[e]))[0];

  afterAll(async()=>{
    if(!sql)return;
    await sql.unsafe("DELETE FROM audit_events WHERE actor_user_id IN (SELECT id FROM users WHERE email=ANY($1::text[]))",[emails]);
    await sql.unsafe("DELETE FROM users WHERE email=ANY($1::text[])",[emails]);
    await sql.end();
  });

  it("creates a verified, password-less free account for a new verified email",async()=>{
    const e=email("new");
    const result=await resolveOAuthSignIn(identity(e));
    expect(result).toMatchObject({ok:true,created:true,user:{email:e,role:"USER"}});
    const row=await user(e);
    expect(row.password_hash).toBeNull();
    expect(row.email_verified_at).not.toBeNull();
    expect(row.anonymous_aggregate_opt_in).toBe(false);
    const subs=await sql!.unsafe("SELECT p.slug FROM subscriptions s JOIN plans p ON p.id=s.plan_id WHERE s.user_id=$1",[row.id]);
    expect(subs.map((r)=>r.slug)).toEqual(["free"]);
  });

  it("blocks uninvited OAuth onboarding but permits existing accounts to sign in",async()=>{
    const invited=email("invite");
    const denied=email("denied");
    const previousMode=process.env.WEALTHARR_PRIVATE_BETA_INVITE_ONLY;
    const previousList=process.env.WEALTHARR_BETA_INVITE_EMAILS;
    try{
      process.env.WEALTHARR_PRIVATE_BETA_INVITE_ONLY="true";
      process.env.WEALTHARR_BETA_INVITE_EMAILS=invited;
      expect(await resolveOAuthSignIn(identity(denied))).toEqual({ok:false,reason:"INVITE_REQUIRED"});
      expect(await user(denied)).toBeUndefined();
      const enrolled=await resolveOAuthSignIn(identity(invited));
      expect(enrolled).toMatchObject({ok:true,created:true});
      process.env.WEALTHARR_BETA_INVITE_EMAILS="";
      expect(await resolveOAuthSignIn(identity(invited))).toMatchObject({ok:true,created:false});
    }finally{
      if(previousMode===undefined)delete process.env.WEALTHARR_PRIVATE_BETA_INVITE_ONLY;
      else process.env.WEALTHARR_PRIVATE_BETA_INVITE_ONLY=previousMode;
      if(previousList===undefined)delete process.env.WEALTHARR_BETA_INVITE_EMAILS;
      else process.env.WEALTHARR_BETA_INVITE_EMAILS=previousList;
    }
  });

  it("recognises a returning identity by its provider id even if the email changed",async()=>{
    const e=email("return");
    const id=identity(e);
    const first=await resolveOAuthSignIn(id);
    const second=await resolveOAuthSignIn({...id,email:"changed-"+e,emailVerified:false});
    expect(first.ok&&second.ok&&first.user.id===second.user.id).toBe(true);
    expect(second.ok&&second.created).toBe(false);
  });

  it("does not let two simultaneous first sign-ins create two accounts",async()=>{
    const e=email("race");
    const results=await Promise.all([resolveOAuthSignIn(identity(e)),resolveOAuthSignIn(identity(e,{provider:"apple"}))]);
    expect(results.every((r)=>r.ok)).toBe(true);
    const ids=new Set(results.map((r)=>r.ok?r.user.id:""));
    expect(ids.size).toBe(1);
    expect((await sql!.unsafe("SELECT count(*)::int AS n FROM users WHERE lower(email)=lower($1)",[e]))[0].n).toBe(1);
  });

  it("refuses a provider that does not vouch for the email, and never links on it",async()=>{
    const e=email("unverified");
    expect(await resolveOAuthSignIn(identity(e,{emailVerified:false}))).toEqual({ok:false,reason:"EMAIL_NOT_VERIFIED"});
    expect(await resolveOAuthSignIn(identity(null))).toEqual({ok:false,reason:"EMAIL_NOT_VERIFIED"});
    expect(await user(e)).toBeUndefined();
    const existing=email("victim");
    await sql!.unsafe("INSERT INTO users (email,password_hash,email_verified_at) VALUES ($1,'x',now())",[existing]);
    expect(await resolveOAuthSignIn(identity(existing,{emailVerified:false}))).toEqual({ok:false,reason:"EMAIL_NOT_VERIFIED"});
    expect((await sql!.unsafe("SELECT count(*)::int AS n FROM oauth_accounts WHERE email=$1",[existing]))[0].n).toBe(0);
  });

  it("links a verified provider email to the existing verified account, keeping its password",async()=>{
    const e=email("link");
    const hash=await bcrypt.hash("a long enough password",4);
    await sql!.unsafe("INSERT INTO users (email,password_hash,email_verified_at) VALUES ($1,$2,now())",[e,hash]);
    const result=await resolveOAuthSignIn(identity(e.toUpperCase()));
    expect(result).toMatchObject({ok:true,created:false});
    expect((await user(e)).password_hash).toBe(hash);
  });

  it("clears the password of a never-verified account when it is claimed through a provider (pre-registration takeover)",async()=>{
    const e=email("squatted");
    await sql!.unsafe("INSERT INTO users (email,password_hash,email_verified_at) VALUES ($1,$2,NULL)",[e,await bcrypt.hash("attacker knows this",4)]);
    const before=Number((await user(e)).session_version);
    await sql!.unsafe("INSERT INTO auth_tokens (user_id,type,token_hash,expires_at) SELECT id,'VERIFY_EMAIL',$2,now()+interval '1 day' FROM users WHERE email=$1",[e,"hash-"+run]);
    const result=await resolveOAuthSignIn(identity(e));
    expect(result).toMatchObject({ok:true,created:false});
    const row=await user(e);
    expect(row.password_hash).toBeNull();
    expect(row.email_verified_at).not.toBeNull();
    expect(Number(row.session_version)).toBe(before+1);
    const open=await sql!.unsafe("SELECT count(*)::int AS n FROM auth_tokens WHERE user_id=$1 AND used_at IS NULL",[row.id]);
    expect(open[0].n).toBe(0);
  });

  it("keeps administrators and two-step accounts on the password route",async()=>{
    const admin=email("admin");
    await sql!.unsafe("INSERT INTO users (email,password_hash,email_verified_at,role) VALUES ($1,'x',now(),'ADMIN')",[admin]);
    expect(await resolveOAuthSignIn(identity(admin))).toEqual({ok:false,reason:"USE_PASSWORD_SIGN_IN"});
    const protectedUser=email("mfa");
    await sql!.unsafe("INSERT INTO users (email,password_hash,email_verified_at,mfa_enabled_at) VALUES ($1,'x',now(),now())",[protectedUser]);
    expect(await resolveOAuthSignIn(identity(protectedUser))).toEqual({ok:false,reason:"USE_PASSWORD_SIGN_IN"});
    // Also once the identity is already linked and the protection is added afterwards.
    const later=email("later");
    const id=identity(later);
    await resolveOAuthSignIn(id);
    await sql!.unsafe("UPDATE users SET mfa_enabled_at=now() WHERE email=$1",[later]);
    expect(await resolveOAuthSignIn(id)).toEqual({ok:false,reason:"USE_PASSWORD_SIGN_IN"});
    await sql!.unsafe("UPDATE users SET mfa_enabled_at=NULL,role='ADMIN' WHERE email=$1",[later]);
    expect(await resolveOAuthSignIn(id)).toEqual({ok:false,reason:"USE_PASSWORD_SIGN_IN"});
  });

  it("never revives a deleted account",async()=>{
    const e=email("deleted");
    await sql!.unsafe("INSERT INTO users (email,password_hash,email_verified_at,deleted_at) VALUES ($1,'x',now(),now())",[e]);
    expect(await resolveOAuthSignIn(identity(e))).toEqual({ok:false,reason:"ACCOUNT_UNAVAILABLE"});
    expect((await sql!.unsafe("SELECT count(*)::int AS n FROM users WHERE lower(email)=lower($1)",[e]))[0].n).toBe(1);
  });

  it("rejects an identity with no provider or subject",async()=>{
    expect(await resolveOAuthSignIn({provider:"",providerAccountId:"x",email:"a@b.test",emailVerified:true})).toEqual({ok:false,reason:"INVALID_IDENTITY"});
    expect(await resolveOAuthSignIn({provider:"google",providerAccountId:" ",email:"a@b.test",emailVerified:true})).toEqual({ok:false,reason:"INVALID_IDENTITY"});
  });
});
