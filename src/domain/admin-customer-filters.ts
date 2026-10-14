/** Read-only filtering for the Admin customer directory.
 * This operates only on rows supplied by the server (currently the newest 250).
 */
export type AdminCustomerRow={
 email:string;country:string;role:string;plan:string;status:string;active:number;attention:number;
};
export type CustomerQuickFilter="ALL"|"SUBSCRIBED"|"STRATEGY_ATTENTION"|"BILLING_ATTENTION";
export const BILLING_ATTENTION_STATUSES=new Set(["PAST_DUE","UNPAID","INCOMPLETE","INCOMPLETE_EXPIRED"]);

export function filterAdminCustomerRows(
 rows:readonly AdminCustomerRow[],filters:{query:string;plan:string;quick:CustomerQuickFilter}
):AdminCustomerRow[]{
 const search=filters.query.trim().toLocaleLowerCase("en-GB");
 return rows.filter(row=>{
  if(filters.plan!=="ALL"&&row.plan!==filters.plan)return false;
  if(filters.quick==="SUBSCRIBED"&&!["ACTIVE","TRIALING"].includes(row.status))return false;
  if(filters.quick==="STRATEGY_ATTENTION"&&row.attention<=0)return false;
  if(filters.quick==="BILLING_ATTENTION"&&!BILLING_ATTENTION_STATUSES.has(row.status))return false;
  return !search||[row.email,row.country,row.role,row.plan,row.status].some(value=>value.toLocaleLowerCase("en-GB").includes(search));
 });
}
