export type IndexedChartPoint={
 date:string;actual?:number;model?:number;benchmark?:number;benchmarkValues?:Record<string,number>;
};
const factor=(base:number|undefined,value:number|undefined)=>{
 if(base==null||value==null||!Number.isFinite(base)||base<=0||!Number.isFinite(value)||value<0)
   return undefined;
 return value/base*100;
};

/**
 * Convert life-to-date 100-based indices into period-specific 100-based growth.
 * Never pretend a series beginning AFTER the selected period is comparable:
 * its opening value must exist on the first actual chart observation.
 */
export function rebaseIndexedWindow(points:IndexedChartPoint[]):IndexedChartPoint[]{
 if(!points.length)return [];
 const anchor=points[0];
 const sourceKeys=Object.keys(anchor.benchmarkValues??{});
 return points.map(row=>({
   ...row,
   actual:factor(anchor.actual,row.actual),
   model:factor(anchor.model,row.model),
   benchmark:factor(anchor.benchmark,row.benchmark),
   benchmarkValues:Object.fromEntries(sourceKeys.flatMap(key=>{
     const rebased=factor(anchor.benchmarkValues?.[key],row.benchmarkValues?.[key]);
     return rebased==null?[]:[[key,rebased]];
   }))
 }));
}

/**
 * Calendar-aligned chart lookbacks. Native Date#setUTCMonth can turn March 31
 * minus one month into March 3; clamp to the actual last date of February.
 */
export function periodCutoffIso(frame:string,lastDate:string):string|null{
  if(["ALL","MAX","CUSTOM"].includes(frame))return null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(lastDate))return null;
  const d=new Date(lastDate+"T00:00:00Z");
  if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==lastDate)return null;
  if(frame==="YTD")return lastDate.slice(0,4)+"-01-01";
  if(frame==="1D"||frame==="1W"){
    d.setUTCDate(d.getUTCDate()-(frame==="1D"?1:7));
    return d.toISOString().slice(0,10);
  }
  const months=({ "1M":1,"3M":3,"6M":6,"1Y":12,"3Y":36,"5Y":60 } as Record<string,number>)[frame];
  if(months==null)return null;
  const total=d.getUTCFullYear()*12+d.getUTCMonth()-months;
  const year=Math.floor(total/12);
  const month=total%12+1;
  const finalDay=new Date(Date.UTC(year,month,0)).getUTCDate();
  const day=Math.min(d.getUTCDate(),finalDay);
  return [String(year).padStart(4,"0"),String(month).padStart(2,"0"),String(day).padStart(2,"0")].join("-");
}
