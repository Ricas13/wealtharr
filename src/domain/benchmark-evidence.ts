import Decimal from "decimal.js";

export type BenchmarkEvidence = {
  key:string;currency?:string;economicExposure:string;provider?:string;
  totalReturnAdjusted?:boolean;commercialLicenceConfirmed?:boolean;fxConversionVerified?:boolean;
  points:Array<{date:string;value:string}>;
};

/**
 * A mere index name or arbitrary admin-entered prices NEVER becomes verified performance.
 * Admin attestations are a technical minimum, not proof of rights or market data accuracy.
 */
export function benchmarkMetadata(e:BenchmarkEvidence):Record<string,unknown> {
  const title=e.key.toUpperCase();
  if(!["VTI","SPY","QQQ"].includes(title) ||
     e.economicExposure!=="BENCHMARK_"+title||
     !e.provider || e.provider.trim().length<3 ||
     !e.totalReturnAdjusted || !e.commercialLicenceConfirmed ||
     !e.currency || !/^[A-Z]{3}$/.test(e.currency.toUpperCase()) ||
     (e.currency.toUpperCase()!=="USD"&&!e.fxConversionVerified) ||
     e.points.length<2)return {};
  const dates=new Set<string>();
  for(const point of e.points){
    const value=new Decimal(point.value);
    const parsed=new Date(point.date+"T00:00:00Z");
    if(!/^\d{4}-\d{2}-\d{2}$/.test(point.date) || !Number.isFinite(parsed.getTime()) ||
       parsed.toISOString().slice(0,10)!==point.date || parsed.getTime()>Date.now() ||
       dates.has(point.date)||!value.isFinite()||value.lte(0))return {};
    dates.add(point.date);
  }
  return {
    currency:e.currency.toUpperCase(),returnBasis:"TOTAL_RETURN",licensed:true,
    adjusted:true,provider:e.provider.trim(),
    fxConverted:e.currency.toUpperCase()!=="USD",
    provenance:"ADMIN_ATTESTED"
  };
}
