import { Bell, CheckCircle2 } from "lucide-react";
import { requirePageUser } from "@/lib/session";
import { sql } from "@/lib/db";
import { MarkAllReadButton } from "@/components/MarkAllReadButton";
import { reminderStillCurrentSql } from "@/lib/review-reminder-sql";

export default async function NotificationsPage(){
  const user=await requirePageUser();
  const rows=await sql.unsafe(
    "SELECT id,type,title,body,read_at,created_at FROM ("+
    " SELECT DISTINCT ON (COALESCE(action_id,id)) id,action_id,type,title,body,read_at,created_at"+
    " FROM notifications n WHERE n.user_id=$1 AND (n.type<>'REVIEW_UPCOMING' OR "+reminderStillCurrentSql("n")+")"+
    " ORDER BY COALESCE(action_id,id),created_at DESC"+
    ") latest ORDER BY created_at DESC LIMIT 100",
    [user.id]
  );
  // Same visibility rule as the list, so the "Mark all as read" button matches what the user can see.
  const unread=await sql.unsafe(
    "SELECT count(*)::int AS c FROM notifications n WHERE n.user_id=$1 AND n.read_at IS NULL AND (n.type<>'REVIEW_UPCOMING' OR "+reminderStillCurrentSql("n")+")",
    [user.id]
  );
  const unreadTotal=Number(unread[0]?.c??0);
  return <>
    <div className="page-title"><div><div className="eyebrow">Activity</div><h1>What changed.</h1><p>Important updates from your strategies, in one quiet timeline.</p></div>{unreadTotal>0&&<MarkAllReadButton/>}</div>
    <section className="glass activity-timeline">
      {rows.length?rows.map((n:any)=><div className={"activity-item "+(n.read_at?"is-read":"is-unread")} key={n.id}>
        <div className="activity-icon"><Bell size={15}/></div>
        <div className="activity-copy"><div className="activity-date">{new Date(n.created_at).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})}</div><strong>{n.title}</strong><p>{n.body}</p></div>
        {!n.read_at&&<span className="activity-unread"><span className="sr-only">Unread</span></span>}
      </div>):<div className="empty activity-empty"><CheckCircle2 size={26}/><strong>Quiet is good.</strong><p>There is no activity to catch up on.</p></div>}
    </section>
  </>;
}
