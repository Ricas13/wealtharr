// Display formatting helpers (pure and client-safe). Presentation only: calculations stay on Decimal.js
// in the domain layer; these helpers never feed a stored or compared value.
//
// Signed output uses `signDisplay:"exceptZero"` so gains and losses are distinguishable without
// relying on colour, and zero is never shown as "+0" or "-0".

const LOCALE="en-GB";
const MISSING="—";

type Numeric=number|string|null|undefined;

function toNumber(value:Numeric){
  if(value===null||value===undefined||value==="")return null;
  const n=typeof value==="number"?value:Number(value);
  return Number.isFinite(n)?n:null;
}

function clampDp(dp:number){
  return Number.isInteger(dp)?Math.min(Math.max(dp,0),20):2;
}

export function money(value:Numeric,currency:string,options:{dp?:number;signed?:boolean}={}){
  const n=toNumber(value);
  if(n===null)return MISSING;
  const dp=clampDp(options.dp??2);
  const signDisplay=options.signed?"exceptZero":"auto";
  try{
    return new Intl.NumberFormat(LOCALE,{style:"currency",currency,minimumFractionDigits:dp,maximumFractionDigits:dp,signDisplay}).format(n);
  }catch{
    // An unknown currency code must not break the page: fall back to a plain number with the code.
    const plain=new Intl.NumberFormat(LOCALE,{minimumFractionDigits:dp,maximumFractionDigits:dp,signDisplay}).format(n);
    return plain+" "+currency;
  }
}

/** `value` is already a percentage figure: 12.5 renders as "12.50%". */
export function pct(value:Numeric,options:{dp?:number;signed?:boolean}={}){
  const n=toNumber(value);
  if(n===null)return MISSING;
  const dp=clampDp(options.dp??2);
  const signDisplay=options.signed?"exceptZero":"auto";
  return new Intl.NumberFormat(LOCALE,{minimumFractionDigits:dp,maximumFractionDigits:dp,signDisplay}).format(n)+"%";
}

/** Share or unit quantities: no padding zeros, up to `maxDp` decimals. */
export function qty(value:Numeric,options:{maxDp?:number;signed?:boolean}={}){
  const n=toNumber(value);
  if(n===null)return MISSING;
  const maxDp=clampDp(options.maxDp??6);
  const signDisplay=options.signed?"exceptZero":"auto";
  return new Intl.NumberFormat(LOCALE,{minimumFractionDigits:0,maximumFractionDigits:maxDp,signDisplay}).format(n);
}

type DateInput=Date|string|number|null|undefined;
const DATE_ONLY=/^\d{4}-\d{2}-\d{2}$/;

function toDate(value:DateInput){
  if(value===null||value===undefined||value==="")return null;
  const date=value instanceof Date?value:new Date(value);
  return Number.isFinite(date.getTime())?date:null;
}

/** A date-only string ("2026-10-12") is a calendar day, so it is shown in UTC and never shifts. */
function zoneFor(value:DateInput,timeZone?:string){
  if(timeZone)return timeZone;
  return typeof value==="string"&&DATE_ONLY.test(value)?"UTC":undefined;
}

function format(value:DateInput,options:Intl.DateTimeFormatOptions,timeZone?:string){
  const date=toDate(value);
  if(!date)return MISSING;
  try{
    return new Intl.DateTimeFormat(LOCALE,{...options,timeZone:zoneFor(value,timeZone)}).format(date);
  }catch{
    return MISSING;
  }
}

export function dateShort(value:DateInput,timeZone?:string){
  return format(value,{day:"numeric",month:"short",year:"numeric"},timeZone);
}

export function dateTime(value:DateInput,timeZone?:string){
  return format(value,{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit",hour12:false},timeZone);
}
