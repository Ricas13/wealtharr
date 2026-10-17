import "./customer-dashboard.css";
import "./member-workspace.css";
import "./adaptive-dashboard.css";
import { requirePageUser } from "@/lib/session";
import { AppShell } from "@/components/AppShell";
import { listUserStrategies } from "@/lib/strategy-service";
import { sql } from "@/lib/db";
import { reminderStillCurrentSql } from "@/lib/review-reminder-sql";
export const dynamic="force-dynamic";
export default async function WorkspaceLayout({children}:{children:React.ReactNode}){const user=await requirePageUser();const rows=await listUserStrategies(user.id);const strategyTabs=rows.filter((s:any)=>s.status==="ACTIVE"||s.status==="PAUSED").map((s:any)=>({id:String(s.id),name:String(s.name)}));const unread=await sql.unsafe("SELECT count(DISTINCT COALESCE(n.action_id,n.id))::int AS c FROM notifications n WHERE n.user_id=$1 AND n.read_at IS NULL AND (n.type<>'REVIEW_UPCOMING' OR "+reminderStillCurrentSql("n")+")",[user.id]);const unreadCount=Number(unread[0]?.c??0);const due=await sql.unsafe("SELECT count(*)::int AS c FROM actions a JOIN strategy_instances i ON i.id=a.strategy_instance_id WHERE i.user_id=$1 AND i.status='ACTIVE' AND a.status IN ('CALCULATED','NOTIFIED','ACKNOWLEDGED') AND a.action_type<>'NO_ACTION'",[user.id]);const tracking={activeStrategies:rows.filter((s:any)=>s.status==="ACTIVE").length,actionsDue:Number(due[0]?.c??0)};return <AppShell isAdmin={user.role==="ADMIN"} strategyTabs={strategyTabs} unreadCount={unreadCount} tracking={tracking}>{children}</AppShell>;}
