import {sql} from "@/lib/db";
import {requireAdminPage} from "@/lib/session";
import {UsersRound,Layers3,ShieldAlert} from "lucide-react";
import {AdminCustomersTable} from "@/components/AdminCustomersTable";
import {AdminCustomerLookup} from "@/components/AdminCustomerLookup";
import {UserStrategyAccessEditor} from "@/components/UserStrategyAccessEditor";
export const dynamic="force-dynamic";
export default async function UsersAdmin(){
 await requireAdminPage();
 const [rows,summary,strategies,accessOverrides]=await Promise.all([
  sql.unsafe("SELECT u.id,u.email,u.country,u.role,p.display_name AS plan,s.status,(SELECT count(*) FROM strategy_instances i WHERE i.user_id=u.id AND i.status='ACTIVE')::int AS active_strategies,(SELECT count(*) FROM strategy_instances i WHERE i.user_id=u.id AND i.health_status<>'HEALTHY' AND i.status='ACTIVE')::int AS unhealthy FROM users u LEFT JOIN subscriptions s ON s.user_id=u.id LEFT JOIN plans p ON p.id=s.plan_id WHERE u.deleted_at IS NULL ORDER BY u.created_at DESC LIMIT 250"),
  sql.unsafe("SELECT (SELECT count(*)::int FROM users WHERE deleted_at IS NULL) AS users,(SELECT count(*)::int FROM strategy_instances WHERE status='ACTIVE') AS strategies,(SELECT count(*)::int FROM strategy_instances WHERE status='ACTIVE' AND health_status<>'HEALTHY') AS attention"),
  sql.unsafe("SELECT key,name FROM strategy_definitions ORDER BY name"),
  sql.unsafe("SELECT a.user_id,d.key,a.allowed FROM user_strategy_access a JOIN strategy_definitions d ON d.id=a.strategy_definition_id JOIN users u ON u.id=a.user_id WHERE u.deleted_at IS NULL ORDER BY a.updated_at DESC LIMIT 5000")
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
  <div style={{marginTop:24}}><UserStrategyAccessEditor
    users={rows.map(u=>({id:String(u.id),email:String(u.email)}))}
    strategies={strategies.map(x=>({key:String(x.key),name:String(x.name)}))}
    initialOverrides={accessOverrides.map(x=>({userId:String(x.user_id),key:String(x.key),allowed:x.allowed===true}))}
  /></div>
 </div>;
}
