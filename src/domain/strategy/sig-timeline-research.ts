import Decimal from "decimal.js";
import {projectGrowthSig,type GrowthSig} from "./sig-research";

/**
 * A transparent what-if worksheet for target direction across multiple
 * quarters. Not Kelly's proprietary lifecycle: this intentionally refuses to
 * imply that a directional signal equals a trade.
 */
export type SigQuarterObservation={
  quarter:string;
  anchor:string;
  newCash:string;
  observedExposure:string;
};
export type SigQuarterProjection=SigQuarterObservation&{
  target:string;
  gap:string;
  indicativeDirection:"BUY"|"SELL"|"HOLD";
};
/**
 * Caller supplies historical confirmed anchors explicitly. They must NOT be
 * inferred from earlier targets when a quarter's order is capped/unfilled.
 */
export function projectSigTimeline(variant:GrowthSig,observations:readonly SigQuarterObservation[]):SigQuarterProjection[]{
  let previousQuarter:string|null=null;
  return observations.map(({quarter,anchor,newCash,observedExposure})=>{
    if(!/^\d{4}-Q[1-4]$/.test(quarter))throw new Error("INVALID_SIG_QUARTER");
    const [yearPart,qPart]=quarter.split("-Q");
    const key=Number(yearPart)*4+Number(qPart);
    if(previousQuarter!==null){
      const [py,pq]=previousQuarter.split("-Q");
      if(key<=Number(py)*4+Number(pq))throw new Error("SIG_QUARTERS_NOT_ASCENDING");
      if(key!==Number(py)*4+Number(pq)+1)throw new Error("SIG_MISSING_QUARTER_REQUIRES_EXPLICIT_RECONCILIATION");
    }
    previousQuarter=quarter;
    const projection=projectGrowthSig({variant,precedingAnchor:new Decimal(anchor),
      newCash:new Decimal(newCash),observedExposure:new Decimal(observedExposure)});
    return {quarter,anchor,newCash,observedExposure,target:projection.target,
      gap:projection.gap,indicativeDirection:projection.indicativeDirection};
  });
}
