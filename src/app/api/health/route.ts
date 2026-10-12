import { sql } from "@/lib/db";
import { ensureSettings } from "@/lib/settings";

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

export async function GET(){
  await ensureSettings();
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
      {ok:coreReady,status:coreReady?"ready":"degraded",database:"ok",capabilities},
      {status:coreReady?200:503,headers}
    );
  }catch{
    return Response.json(
      {ok:false,status:"unavailable",database:"unavailable"},
      {status:503,headers}
    );
  }
}
