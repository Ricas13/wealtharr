import "./customer-dashboard.css";
import { requirePageUser } from "@/lib/session";
import { AppShell } from "@/components/AppShell";
import { listUserStrategies } from "@/lib/strategy-service";
import { sql } from "@/lib/db";
export const dynamic="force-dynamic";
export default async function WorkspaceLayout({children}:{children:React.ReactNode}){const user=await requirePageUser();const rows=await listUserStrategies(user.id);const strategyTabs=rows.filter((s:any)=>s.status==="ACTIVE"||s.status==="PAUSED").map((s:any)=>({id:String(s.id),name:String(s.name)}));const unread=await sql.unsafe("SELECT count(DISTINCT COALESCE(action_id,id))::int AS c FROM notifications WHERE user_id=$1 AND read_at IS NULL",[user.id]);const unreadCount=Number(unread[0]?.c??0);return <AppShell isAdmin={user.role==="ADMIN"} strategyTabs={strategyTabs} unreadCount={unreadCount}>{children}</AppShell>;}
