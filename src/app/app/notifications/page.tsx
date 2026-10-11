import { Bell, CheckCircle2 } from "lucide-react";
import { requirePageUser } from "@/lib/session";
import { sql } from "@/lib/db";
import { MarkAllReadButton } from "@/components/MarkAllReadButton";

export default async function NotificationsPage(){
  const user=await requirePageUser();
  const rows=await sql.unsafe(
    "SELECT id,type,title,body,read_at,created_at FROM ("+
    " SELECT DISTINCT ON (COALESCE(action_id,id)) id,action_id,type,title,body,read_at,created_at"+
    " FROM notifications WHERE user_id=$1"+
    " ORDER BY COALESCE(action_id,id),created_at DESC"+
    ") latest ORDER BY created_at DESC LIMIT 100",
    [user.id]
  );
  const unread=await sql.unsafe("SELECT count(*)::int AS c FROM notifications WHERE user_id=$1 AND read_at IS NULL",[user.id]);
  const unreadTotal=Number(unread[0]?.c??0);
  return <>
    <div className="page-title"><div><div className="eyebrow">Activity</div><h1>What changed.</h1><p>Important updates from your strategies, in one quiet timeline.</p></div>{unreadTotal>0&&<MarkAllReadButton/>}</div>
    <section className="glass activity-timeline">
      {rows.length?rows.map((n:any)=><div className="activity-item" key={n.id}>
        <div className="activity-icon"><Bell size={15}/></div>
        <div className="activity-copy"><div className="activity-date">{new Date(n.created_at).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})}</div><strong>{n.title}</strong><p>{n.body}</p></div>
        {!n.read_at&&<span className="activity-unread"/>}
      </div>):<div className="empty activity-empty"><CheckCircle2 size={26}/><strong>Quiet is good.</strong><p>There is no activity to catch up on.</p></div>}
    </section>
  </>;
}