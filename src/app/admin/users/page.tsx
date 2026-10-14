import {sql} from "@/lib/db";
import {requireAdminPage} from "@/lib/session";
import {UsersRound,Layers3,ShieldAlert} from "lucide-react";
import {AdminCustomersTable} from "@/components/AdminCustomersTable";
import {AdminCustomerLookup} from "@/components/AdminCustomerLookup";
export const dynamic="force-dynamic";
export default async function UsersAdmin(){
 await requireAdminPage();
 const [rows,summary]=await Promise.all([
  sql.unsafe("SELECT u.id,u.email,u.country,u.role,p.display_name AS plan,s.status,(SELECT count(*) FROM strategy_instances i WHERE i.user_id=u.id AND i.status='ACTIVE')::int AS active_strategies,(SELECT count(*) FROM strategy_instances i WHERE i.user_id=u.id AND i.health_status<>'HEALTHY' AND i.status='ACTIVE')::int AS unhealthy FROM users u LEFT JOIN subscriptions s ON s.user_id=u.id LEFT JOIN plans p ON p.id=s.plan_id WHERE u.deleted_at IS NULL ORDER BY u.created_at DESC LIMIT 250"),
  sql.unsafe("SELECT (SELECT count(*)::int FROM users WHERE deleted_at IS NULL) AS users,(SELECT count(*)::int FROM strategy_instances WHERE status='ACTIVE') AS strategies,(SELECT count(*)::int FROM strategy_instances WHERE status='ACTIVE' AND health_status<>'HEALTHY') AS attention")
 ]);
 const metrics=[
  {name:"Registered customers",value:Number(summary[0]?.users??0),Icon:UsersRound},
  {name:"Active strategies",value:Number(summary[0]?.strategies??0),Icon:Layers3},
  {name:"Strategies to review",value:Number(summary[0]?.attention??0),Icon:ShieldAlert}
 ];
 return <div>
  <div className="admin-design-heading"><div><span className="admin-kicker">WORKSPACE / CUSTOMERS</span>
   <h1>Customers</h1><p>Account and subscription health, without exposing portfolio balances.</p></div></div>
  <div className="admin-overview-kpis admin-three-kpis">{metrics.map(({name,value,Icon})=><div className="admin-design-kpi" key={name}>
    <span className="admin-design-kpi-title">{name}<Icon size={17} aria-hidden="true"/></span><strong>{new Intl.NumberFormat("en-GB").format(value)}</strong>
    <span className="admin-design-kpi-detail">Current database records</span></div>)}</div>
  <AdminCustomerLookup/>
  <div style={{marginTop:20}}><AdminCustomersTable rows={rows.map(u=>({
   id:String(u.id),email:String(u.email),country:String(u.country??"—"),role:String(u.role??"USER"),plan:String(u.plan??"No subscription"),status:String(u.status??"Unassigned"),
   active:Number(u.active_strategies??0),attention:Number(u.unhealthy??0)
  }))}/></div>
  <section className="admin-design-panel" style={{marginTop:24}} aria-labelledby="admin-customer-management-guide">
   <h2 id="admin-customer-management-guide">Manage an individual account</h2>
   <p className="admin-data-caveat">Choose a customer from full-database search or the recent directory to review subscription health and edit their strategy permissions. Overrides are audited and still respect plan, regional and global restrictions.</p>
  </section>
 </div>;
}
