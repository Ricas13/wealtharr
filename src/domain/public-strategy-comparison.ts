import Decimal from "decimal.js";

/**
 * Public model comparisons are *historical illustrations*, never a live customer
 * account or a recommendation. The administrator must explicitly attest to the
 * source, rights and calculation basis. Missing evidence is not a zero return.
 */
export type PublicPeriod="1Y"|"3Y"|"5Y"|"ALL";
export type DatedValue={date:string;value:string};
export type ReturnWindow={start:string;end:string;percent:number;points:Array<{date:string;index:number}>};
export type PublicComparisonEntry={key:string;name:string;family:string;available:boolean;reason:string;
  observations:DatedValue[]};
export const PUBLIC_MODEL_SOURCE="PUBLIC_VERIFIED_TOTAL_RETURN";
export const SPY_BENCHMARK_KEY="SPY";

function validDate(input:string):boolean{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(input))return false;
  const d=new Date(input+"T00:00:00Z");
  return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===input;
}
export function modelComparisonMetadata(input:{
  provider:string;currency:string;commercialLicenceConfirmed:boolean;
  methodologyReviewed:boolean;cashFlowNeutral:boolean;
  dividendsAndFeesIncluded:boolean;points:DatedValue[];
}):Record<string,unknown>{
  if(!input.commercialLicenceConfirmed||!input.methodologyReviewed||
    !input.cashFlowNeutral||!input.dividendsAndFeesIncluded||
    input.currency!=="USD"||input.provider.trim().length<3||
    input.points.length<2||input.points.length>5000)return {};
  const seen=new Set<string>();
  let prior="";
  for(const row of input.points){
    let v:Decimal;
    try{v=new Decimal(row.value);}catch{return {};}
    if(!validDate(row.date)||row.date>new Date().toISOString().slice(0,10)||
       row.date<=prior||seen.has(row.date)||!v.isFinite()||v.lte(0))return {};
    seen.add(row.date);prior=row.date;
  }
  return {
    publicationStatus:"PUBLIC_VERIFIED",returnBasis:"TOTAL_RETURN_INDEX",
    currency:"USD",provider:input.provider.trim(),
    commercialLicenceConfirmed:true,methodologyReviewed:true,
    cashFlowNeutral:true,dividendsAndFeesIncluded:true,
    provenance:"ADMIN_ATTESTED"
  };
}
export function isApprovedModelPoint(source:string,metadata:unknown):boolean{
  if(source!==PUBLIC_MODEL_SOURCE||!metadata||typeof metadata!=="object"||Array.isArray(metadata))return false;
  const m=metadata as Record<string,unknown>;
  return m.publicationStatus==="PUBLIC_VERIFIED"&&m.returnBasis==="TOTAL_RETURN_INDEX"&&
    m.currency==="USD"&&m.commercialLicenceConfirmed===true&&m.methodologyReviewed===true&&
    m.cashFlowNeutral===true&&m.dividendsAndFeesIncluded===true&&m.provenance==="ADMIN_ATTESTED"&&
    typeof m.provider==="string"&&m.provider.trim().length>=3;
}
export function isApprovedSpyPoint(exposure:string,metadata:unknown):boolean{
  if(exposure!=="BENCHMARK_SPY"||!metadata||typeof metadata!=="object"||Array.isArray(metadata))return false;
  const m=metadata as Record<string,unknown>;
  return m.currency==="USD"&&m.returnBasis==="TOTAL_RETURN"&&
    m.licensed===true&&m.adjusted===true&&m.provenance==="ADMIN_ATTESTED"&&
    typeof m.provider==="string"&&m.provider.trim().length>=3;
}
export function validatedObservations(rows:readonly DatedValue[]):DatedValue[]{
  let previous="";
  return rows.flatMap(row=>{
    if(!validDate(row.date)||row.date<=previous)return [];
    previous=row.date;
    try{
      const n=new Decimal(row.value);
      return n.isFinite()&&n.gt(0)?[{date:row.date,value:n.toString()}]:[];
    }catch{return [];}
  });
}
function utcDays(a:string,b:string){return Math.round((Date.parse(b+"T00:00:00Z")-Date.parse(a+"T00:00:00Z"))/86400000);}
export function periodStart(end:string,period:PublicPeriod){
  if(period==="ALL")return null;
  const d=new Date(end+"T00:00:00Z");
  d.setUTCFullYear(d.getUTCFullYear()-(period==="1Y"?1:period==="3Y"?3:5));
  return d.toISOString().slice(0,10);
}
/**
 * Exact matching observation days only. No FX conversion, interpolation,
 * guessed dividends or artificial SPY prices. A selected fixed horizon must
 * have the correct start date (within 35 days for monthly review schedules).
 * Rebase each curve to 100 at the SAME date.
 */
export function alignedWindow(model:readonly DatedValue[],benchmark:readonly DatedValue[],
  period:PublicPeriod,referenceDate:string):{model:ReturnWindow;spy:ReturnWindow}|null{
  if(!validDate(referenceDate))return null;
  const left=validatedObservations(model),right=validatedObservations(benchmark);
  const spyByDate=new Map(right.map(row=>[row.date,row.value]));
  const paired=left.filter(row=>spyByDate.has(row.date)&&row.date<=referenceDate);
  if(paired.length<2)return null;
  const end=paired[paired.length-1].date;
  // Quarterly published results may be as of the last quarter. We do not
  // claim they are today's performance or label them "live".
  if(utcDays(end,referenceDate)>55)return null;
  const cutoff=periodStart(end,period);
  const eligible=cutoff?paired.filter(row=>row.date>=cutoff):paired;
  if(eligible.length<2)return null;
  if(cutoff&&utcDays(cutoff,eligible[0].date)>35)return null;
  const baseline=eligible[0];
  const baseModel=new Decimal(baseline.value);
  const baseSpy=new Decimal(spyByDate.get(baseline.date)!);
  const normalise=(source:"model"|"spy")=>{
    const divisor=source==="model"?baseModel:baseSpy;
    const points=eligible.map(row=>({
      date:row.date,
      index:new Decimal(source==="model"?row.value:spyByDate.get(row.date)!).div(divisor).mul(100).toNumber()
    }));
    const last=points[points.length-1].index;
    return {start:baseline.date,end,percent:(last-100),points};
  };
  return {model:normalise("model"),spy:normalise("spy")};
}
/** Common dates across all toggled series; comparisons must share start/end. */
export function chartRows(selected:readonly {key:string;points:DatedValue[]}[],spy:readonly DatedValue[],
 period:PublicPeriod,asOf:string):Array<{date:string;[key:string]:string|number}>{
  if(selected.length===0)return [];
  const spyMap=new Map(validatedObservations(spy).map(p=>[p.date,p.value]));
  const models=selected.map(s=>({key:s.key,values:new Map(validatedObservations(s.points).map(p=>[p.date,p.value]))}));
  const common=[...spyMap.keys()].filter(date=>date<=asOf&&models.every(s=>s.values.has(date))).sort();
  if(common.length<2||utcDays(common[common.length-1],asOf)>55)return [];
  const end=common[common.length-1],cutoff=periodStart(end,period);
  const eligible=cutoff?common.filter(d=>d>=cutoff):common;
  if(eligible.length<2||(cutoff&&utcDays(cutoff,eligible[0])>35))return [];
  const baseline=eligible[0];
  return eligible.map(date=>{
    const row:{date:string;[key:string]:string|number}={date,SPY:new Decimal(spyMap.get(date)!).div(spyMap.get(baseline)!).mul(100).toNumber()};
    for(const s of models)row[s.key]=new Decimal(s.values.get(date)!).div(s.values.get(baseline)!).mul(100).toNumber();
    return row;
  });
}
