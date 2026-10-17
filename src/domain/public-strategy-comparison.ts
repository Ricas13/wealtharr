import Decimal from "decimal.js";

/**
 * Public model comparisons are *historical illustrations*, never a live customer
 * account or a recommendation. The administrator must explicitly attest to the
 * source, rights and calculation basis. Missing evidence is not a zero return.
 */
export type PublicPeriod="1Y"|"3Y"|"5Y"|"10Y"|"ALL";
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
  const result:DatedValue[]=[];
  for(const row of rows){
    if(!validDate(row.date)||row.date<=previous)return [];
    previous=row.date;
    try{
      const n=new Decimal(row.value);
      if(!n.isFinite()||n.lte(0))return [];
      result.push({date:row.date,value:n.toString()});
    }catch{return [];}
  }
  return result;
}
function utcDays(a:string,b:string){return Math.round((Date.parse(b+"T00:00:00Z")-Date.parse(a+"T00:00:00Z"))/86400000);}
export function periodStart(end:string,period:PublicPeriod){
  if(period==="ALL")return null;
  const d=new Date(end+"T00:00:00Z");
  d.setUTCFullYear(d.getUTCFullYear()-(period==="1Y"?1:period==="3Y"?3:period==="5Y"?5:10));
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
/**
 * All plotted strategies share the SAME verified starting and ending closes,
 * but their intermediate observations may be weekly, monthly or daily.
 *
 * Rebase from exact common anchor dates, then preserve each strategy's ACTUAL
 * intermediate closes as sparse points in the union of observation dates.
 * This avoids the previous bug where adding a second strategy with different
 * review dates erased both lines. No prices or tooltip values are interpolated.
 * The chart UI may visually connect two confirmed points, as standard for a
 * historical line chart, with that convention disclosed to viewers.
 */
export function chartRows(selected:readonly {key:string;points:DatedValue[]}[],spy:readonly DatedValue[],
 period:PublicPeriod,asOf:string):Array<{date:string;[key:string]:string|number}>{
  const spyMap=new Map(validatedObservations(spy).map(p=>[p.date,p.value]));
  const models=selected.map(s=>({key:s.key,values:new Map(validatedObservations(s.points).map(p=>[p.date,p.value]))}));
  if(!validDate(asOf)||spyMap.size<2||models.some(m=>m.values.size<2))return [];
  const common=[...spyMap.keys()].filter(date=>date<=asOf&&models.every(s=>s.values.has(date))).sort();
  if(common.length<2||utcDays(common[common.length-1],asOf)>55)return [];
  const end=common[common.length-1],cutoff=periodStart(end,period);
  const eligible=cutoff?common.filter(d=>d>=cutoff):common;
  if(eligible.length<2||(cutoff&&utcDays(cutoff,eligible[0])>35))return [];
  const baseline=eligible[0];
  const baselineSpy=new Decimal(spyMap.get(baseline)!);
  const baselineModels=models.map(s=>({key:s.key,values:s.values,baseline:new Decimal(s.values.get(baseline)!)}));
  const visibleDates=[...spyMap.keys()].filter(date=>date>=baseline&&date<=end).sort();
  return visibleDates.map(date=>{
    const row:{date:string;[key:string]:string|number}={
      date,SPY:new Decimal(spyMap.get(date)!).div(baselineSpy).mul(100).toNumber()
    };
    for(const model of baselineModels){
      const observed=model.values.get(date);
      if(observed!==undefined)row[model.key]=new Decimal(observed).div(model.baseline).mul(100).toNumber();
    }
    return row;
  });
}
