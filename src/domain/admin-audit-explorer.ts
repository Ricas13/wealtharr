/** Admin audit explorer filters. Deliberately restrict input to action names, not raw JSON metadata. */
export const AUDIT_PAGE_SIZE=50;
export type AuditPeriod=0|7|30|90;

export function parseAuditFilters(raw:{action?:unknown;days?:unknown;page?:unknown}){
 const candidate=typeof raw.action==="string"?raw.action.trim():"";
 const validAction=/^[A-Za-z0-9_.:-]{0,64}$/.test(candidate);
 const action=validAction?candidate:"";
 const inputDays=typeof raw.days==="string"?Number(raw.days):30;
 const days:AuditPeriod=(inputDays===0||inputDays===7||inputDays===30||inputDays===90)?inputDays:30;
 const inputPage=typeof raw.page==="string"&&/^[1-9]\d{0,4}$/.test(raw.page)?Number(raw.page):1;
 return {action,days,page:inputPage,invalidAction:!validAction};
}

export function auditPageWindow(total:number,requestedPage:number){
 const pages=Math.max(1,Math.ceil(Math.max(0,Math.floor(total))/AUDIT_PAGE_SIZE));
 const page=Math.min(pages,Math.max(1,requestedPage));
 return {page,pages,limit:AUDIT_PAGE_SIZE,offset:(page-1)*AUDIT_PAGE_SIZE};
}

export function auditPageHref(action:string,days:AuditPeriod,page:number){
 const params=new URLSearchParams({action,days:String(days),page:String(page)});
 return "/admin/security/audit?"+params.toString();
}
