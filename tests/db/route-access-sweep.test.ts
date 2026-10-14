import { afterAll,describe,expect,it,vi } from "vitest";
import { randomUUID } from "node:crypto";

// Walks every API route module and calls each exported handler as (a) nobody and (b) an ordinary
// signed-in user. Nothing here needs valid input: authentication and authorisation must be decided
// before the body is even read, and must answer with 401/403 rather than success or a 5xx.
type SessionUser={id:string;email:string;country:string;baseCurrency:string;timezone:string;role:string;anonymousAggregateOptIn:boolean};
const session=vi.hoisted(()=>({user:null as SessionUser|null}));
vi.mock("@/lib/session",()=>({
  requireUser:async()=>{if(!session.user)throw new Error("UNAUTHENTICATED");return session.user;},
  requireAdmin:async()=>{
    if(!session.user)throw new Error("UNAUTHENTICATED");
    if(session.user.role!=="ADMIN")throw new Error("FORBIDDEN");
    return session.user;
  },
  requireAdminWithMfa:async()=>{
    if(!session.user)throw new Error("UNAUTHENTICATED");
    if(session.user.role!=="ADMIN")throw new Error("FORBIDDEN");
    return session.user;
  },
  requirePageUser:async()=>{if(!session.user)throw new Error("UNAUTHENTICATED");return session.user;}
}));

const ORIGIN="http://127.0.0.1:3000";
const loaders=import.meta.glob("/src/app/api/**/route.ts") as Record<string,()=>Promise<Record<string,unknown>>>;
const METHODS=["GET","POST","PUT","PATCH","DELETE"] as const;

// Routes that are public by design and enforce their own checks (token, signature, secret).
const PUBLIC=[
  "/src/app/api/auth/[...nextauth]/route.ts",
  "/src/app/api/register/route.ts",
  "/src/app/api/verify-email/route.ts",
  "/src/app/api/password-reset/request/route.ts",
  "/src/app/api/password-reset/confirm/route.ts",
  "/src/app/api/health/route.ts",
  "/src/app/api/setup/route.ts"
];
const SELF_AUTHENTICATED=["/src/app/api/stripe/webhook/route.ts","/src/app/api/cron/actions/route.ts","/src/app/api/billing/store/webhook/route.ts","/src/app/api/cron/health/route.ts","/src/app/api/cron/heartbeat/route.ts"];

const ordinary:SessionUser={id:randomUUID(),email:"nobody@example.test",country:"GB",baseCurrency:"GBP",timezone:"Europe/London",role:"USER",anonymousAggregateOptIn:true};
const outcomes:Array<{route:string;method:string;caller:string;status:number}> = [];

async function invoke(path:string,method:string,caller:SessionUser|null){
  session.user=caller;
  const handler=(await loaders[path]())[method] as ((request:Request,context:{params:Promise<Record<string,string>>})=>Promise<Response>)|undefined;
  if(!handler)return null;
  const request=new Request(ORIGIN+"/api/probe",{
    method,
    headers:{origin:ORIGIN,"content-type":"application/json"},
    body:method==="GET"?undefined:"{}"
  });
  const response=await handler(request,{params:Promise.resolve({id:randomUUID(),eventId:randomUUID()})});
  return response.status;
}

describe.skipIf(!process.env.DATABASE_URL)("route access sweep",()=>{
  afterAll(()=>{console.log("ACCESS_OUTCOMES",JSON.stringify(outcomes));});

  const protectedRoutes=Object.keys(loaders).filter((path)=>!PUBLIC.includes(path)&&!SELF_AUTHENTICATED.includes(path)).sort();

  it("discovers the route set",()=>{
    expect(protectedRoutes.length).toBeGreaterThan(25);
  });

  for(const path of protectedRoutes){
    const label=path.replace("/src/app/api/","").replace("/route.ts","");
    for(const method of METHODS){
      it(`${method} ${label}: no session never succeeds`,async()=>{
        const status=await invoke(path,method,null);
        if(status===null)return;
        outcomes.push({route:label,method,caller:"anonymous",status});
        expect(status,"an anonymous call is answered 401").toBe(401);
      });
    }
    if(path.includes("/api/admin/")){
      for(const method of METHODS){
        it(`${method} ${label}: ordinary user is refused`,async()=>{
          const status=await invoke(path,method,ordinary);
          if(status===null)return;
          outcomes.push({route:label,method,caller:"user",status});
          expect(status,"a non-admin call is answered 403").toBe(403);
        });
      }
    }
  }

  it("cron refuses calls without the bearer secret",async()=>{
    process.env.CRON_SECRET="sweep-secret-long-enough";
    session.user=null;
    const {GET}=await loaders["/src/app/api/cron/actions/route.ts"]() as {GET:(r:Request)=>Promise<Response>};
    expect((await GET(new Request(ORIGIN+"/api/cron/actions"))).status).toBe(401);
    expect((await GET(new Request(ORIGIN+"/api/cron/actions",{headers:{authorization:"Bearer wrong"}}))).status).toBe(401);
  });

  it("the Stripe webhook refuses unsigned and wrongly signed calls",async()=>{
    process.env.STRIPE_SECRET_KEY="sk_test_sweep";
    process.env.STRIPE_WEBHOOK_SECRET="whsec_sweep";
    const {POST}=await loaders["/src/app/api/stripe/webhook/route.ts"]() as {POST:(r:Request)=>Promise<Response>};
    expect((await POST(new Request(ORIGIN+"/api/stripe/webhook",{method:"POST",body:"{}"}))).status).toBe(400);
    expect((await POST(new Request(ORIGIN+"/api/stripe/webhook",{method:"POST",headers:{"stripe-signature":"t=1,v1=00"},body:"{}"}))).status).toBe(400);
  });
});
