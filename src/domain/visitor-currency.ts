export type LandingCurrency="GBP"|"EUR"|"USD";
const EUROPE=new Set([
 "AL","AD","AT","BE","BA","BG","HR","CY","CZ","DK","EE","FI","FR","DE",
 "GR","HU","IS","IE","IT","XK","LV","LI","LT","LU","MT","MD","MC","ME","NL",
 "MK","NO","PL","PT","RO","SM","RS","SK","SI","ES","SE","CH","UA","VA",
 "BY","TR","GE","AM","AZ"
]);
/** The original country is supplied by Cloudflare, not inferred from language/browser locale.
 * IP-based currency is a display *preference*. Never convert or invent a plan amount.
 */
export function currencyForVisitorCountry(country:string|null|undefined):LandingCurrency{
 const iso=country?.trim().toUpperCase();
 if(iso==="GB"||iso==="UK")return "GBP";
 if(iso&&EUROPE.has(iso))return "EUR";
 return "USD";
}
