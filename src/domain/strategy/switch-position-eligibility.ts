import Decimal from "decimal.js";
import type {RequiredPosition} from "./market-eligibility";

export type HeldSwitchPosition={instrumentId:string;quantity:string};
export type HeldInstrument={id:string;exposure:string;leverage:string;direction:string};

/**
 * A switch does NOT liquidate assets or change economic exposure.
 * The transferred holdings must already be valid managed sleeves of the
 * destination, otherwise preserve the source journey and require reconciliation.
 */
export function switchPositionDiscrepancies(
 positions:HeldSwitchPosition[],instruments:HeldInstrument[],required:RequiredPosition[]
):string[]{
 const byId=new Map(instruments.map(instrument=>[instrument.id,instrument]));
 const acceptable=new Set(required.map(position=>
  [position.economicExposure,new Decimal(position.leverage).toString(),position.direction].join("|")));
 const blocked:string[]=[];
 for(const position of positions){
  let quantity:Decimal;
  try{quantity=new Decimal(position.quantity);}catch{blocked.push(position.instrumentId);continue;}
  if(!quantity.isFinite()||quantity.lt(0)){blocked.push(position.instrumentId);continue;}
  if(quantity.isZero())continue;
  const instrument=byId.get(position.instrumentId);
  if(!instrument){blocked.push(position.instrumentId);continue;}
  let leverage:string;
  try{leverage=new Decimal(instrument.leverage).toString();}catch{blocked.push(position.instrumentId);continue;}
  if(!acceptable.has([instrument.exposure,leverage,instrument.direction].join("|")))
   blocked.push(position.instrumentId);
 }
 return [...new Set(blocked)];
}
