import Decimal from "decimal.js";
/** ISO 4217 minor-unit conversions for UI prices, not foreign exchange.
 * All values stored in the database remain integer minor units.
 */
export function currencyMinorDigits(currency:string):number{
 const formatter=new Intl.NumberFormat("en-GB",{style:"currency",currency:currency.toUpperCase()});
 return formatter.resolvedOptions().maximumFractionDigits??2;
}
export function majorFromMinor(minor:number,currency:string):number{
 return minor/10**currencyMinorDigits(currency);
}
export function minorFromMajor(major:number,currency:string):number{
 if(!Number.isFinite(major)||major<0)throw new Error("Invalid amount");
 const amount=Math.round(major*10**currencyMinorDigits(currency));
 if(!Number.isSafeInteger(amount))throw new Error("Invalid amount");
 return amount;
}
/** Parse a typed major-unit amount ("9.99") into integer minor units without floating point. */
export function minorFromMajorText(text:string,currency:string):number{
 let major:Decimal;
 try{major=new Decimal(text.trim()===""?"0":text.trim());}catch{throw new Error("Invalid amount");}
 if(!major.isFinite()||major.lt(0))throw new Error("Invalid amount");
 const minor=major.mul(new Decimal(10).pow(currencyMinorDigits(currency))).toDecimalPlaces(0,Decimal.ROUND_HALF_EVEN).toNumber();
 if(!Number.isSafeInteger(minor))throw new Error("Invalid amount");
 return minor;
}
export function exactPriceString(minor:number,currency:string):string{
 const digits=currencyMinorDigits(currency);
 return new Decimal(minor).div(new Decimal(10).pow(digits)).toFixed(digits);
}
export function formatMinorCurrency(minor:number,currency:string):string{
 try{
  if(!Number.isSafeInteger(minor))throw new Error("Invalid amount");
  return new Intl.NumberFormat("en-GB",{style:"currency",currency:currency.toUpperCase()})
   .format(majorFromMinor(minor,currency));
 }catch{
  return String(minor)+" "+currency.toUpperCase()+" minor units";
 }
}
