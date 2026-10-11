import { requirePageUser } from "@/lib/session";
import { AppShell } from "@/components/AppShell";
import { listUserStrategies } from "@/lib/strategy-service";
export const dynamic="force-dynamic";
export default async function WorkspaceLayout({children}:{children:React.ReactNode}){const user=await requirePageUser();const rows=await listUserStrategies(user.id);const strategyTabs=rows.filter((s:any)=>s.status==="ACTIVE"||s.status==="PAUSED").map((s:any)=>({id:String(s.id),name:String(s.name)}));return <AppShell isAdmin={user.role==="ADMIN"} strategyTabs={strategyTabs}>{children}</AppShell>;}
