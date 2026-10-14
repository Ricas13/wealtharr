import {z} from "zod";
import {sql} from "@/lib/db";
import {requireAdmin} from "@/lib/session";
import {assertSameOrigin,consumeRateLimit} from "@/lib/security";
import {authFailure} from "@/lib/api-auth";
import {customerLookupInput,customerLookupWindow} from "@/domain/admin-customer-lookup";

export const dynamic="force-dynamic";

/** A deliberately narrow, read-only, admin-only search. Never return customer holdings or payment identifiers. */
export async function POST(request:Request){
 try{
  assertSameOrigin(request);
  const admin=await requireAdmin();
  await consumeRateLimit("admin-customer-lookup:"+admin.id,40,60);
  const input=customerLookupInput.parse(await request.json());
  const totals=await sql.unsafe(
   "SELECT count(*)::int AS c FROM users u WHERE u.deleted_at IS NULL AND strpos(lower(u.email),lower($1::text))>0",
   [input.emailQuery]
  );
  const total=Number(totals[0]?.c??0);
  const window=customerLookupWindow(total,input.page);
  const matches=total?await sql.unsafe(
   "SELECT u.email,u.country,u.role,coalesce(p.display_name,'No subscription') AS plan,"+
   "coalesce(s.status,'Unassigned') AS status FROM users u "+
   "LEFT JOIN subscriptions s ON s.user_id=u.id LEFT JOIN plans p ON p.id=s.plan_id "+
   "WHERE u.deleted_at IS NULL AND strpos(lower(u.email),lower($1::text))>0 "+
   "ORDER BY u.created_at DESC,u.id DESC LIMIT $2 OFFSET $3",
   [input.emailQuery,window.limit,window.offset]
  ):[];
  return Response.json({
   total,page:window.page,totalPages:window.pages,
   customers:matches.map(r=>({
    email:String(r.email),country:String(r.country??"—"),role:String(r.role??"USER"),
    plan:String(r.plan),status:String(r.status)
   }))
  },{headers:{"cache-control":"no-store"}});
 }catch(error){
  const denied=authFailure(error);
  if(denied)return denied;
  if(error instanceof z.ZodError)return Response.json({error:"Enter at least 3 and at most 100 valid characters."},{status:400,headers:{"cache-control":"no-store"}});
  if(error instanceof Error&&error.message==="RATE_LIMITED")return Response.json({error:"Too many searches. Try again shortly."},{status:429,headers:{"cache-control":"no-store"}});
  return Response.json({error:"Customer search is temporarily unavailable."},{status:500,headers:{"cache-control":"no-store"}});
 }
}
