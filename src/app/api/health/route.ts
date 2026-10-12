import { sql } from "@/lib/db";
import { ensureSettings } from "@/lib/settings";
import { cronAuthorized } from "@/lib/cron-auth";

export const dynamic="force-dynamic";

function validUrl(value:string|undefined){
  if(!value)return false;
  try{
    const url=new URL(value);
    return url.protocol==="https:"||url.hostname==="localhost"||url.hostname==="127.0.0.1";
  }catch{
    return false;
  }
}

function validEncryptionKey(value:string|undefined){
  if(!value)return false;
  try{return Buffer.from(value,"base64").length===32;}catch{return false;}
}

// The public answer is only the readiness status (the HTTP code carries it too), which is all a load
// balancer or container health check needs. Which integrations are configured is operational detail
// for the operator, so it needs the cron bearer secret (as /api/cron/health does).
export async function GET(request: Request){
  await ensureSettings();
  const detailed=cronAuthorized(request);
  const headers={"cache-control":"no-store"};
  try{
    await sql.unsafe("SELECT 1 AS ok");

    const coreReady=
      validUrl(process.env.NEXT_PUBLIC_APP_URL)&&
      Boolean(process.env.AUTH_SECRET&&process.env.AUTH_SECRET.length>=32)&&
      Boolean(process.env.CRON_SECRET&&process.env.CRON_SECRET.length>=24)&&
      validEncryptionKey(process.env.APP_ENCRYPTION_KEY);

    const capabilities={
      billing:Boolean(process.env.STRIPE_SECRET_KEY&&process.env.STRIPE_WEBHOOK_SECRET),
      email:Boolean(process.env.EMAIL_HTTP_ENDPOINT&&process.env.EMAIL_HTTP_TOKEN&&process.env.EMAIL_FROM),
      marketData:Boolean(
        (
        process.env.MARKET_DATA_PROVIDER==="http"&&
        process.env.MARKET_DATA_HTTP_BASE_URL&&
        process.env.MARKET_DATA_HTTP_TOKEN)
      )
    };

    return Response.json(
      detailed
        ?{ok:coreReady,status:coreReady?"ready":"degraded",database:"ok",capabilities}
        :{status:coreReady?"ready":"degraded"},
      {status:coreReady?200:503,headers}
    );
  }catch{
    return Response.json(
      detailed?{ok:false,status:"unavailable",database:"unavailable"}:{status:"unavailable"},
      {status:503,headers}
    );
  }
}
