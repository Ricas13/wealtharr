/** Safe, explicitly opt-in public indexing for a self-hosted investment SaaS. */
export const publicSeoRoutes=["/","/features","/strategies","/pricing","/faq","/tools/rebalance-calculator",
 "/learn","/learn/portfolio-rebalancing","/learn/uk-isa-portfolio-tracking","/learn/leveraged-etp-risks",
 "/learn/portfolio-tracking-spreadsheet","/research-disclaimer"] as const;
export const privateRoutePrefixes=["/admin","/app","/api","/login","/register","/reset-password","/verify-email","/demo"];
export function siteOrigin(input?:string){
  try{
    const url=new URL(input||"http://localhost:3000");
    if(!["http:","https:"].includes(url.protocol))throw new Error("INVALID_ORIGIN");
    url.pathname="/";url.search="";url.hash="";url.username="";url.password="";
    return url;
  }catch{return new URL("http://localhost:3000");}
}
export function publicIndexingEnabled(env:Record<string,string|undefined>){
  return env.NODE_ENV==="production"&&env.PUBLIC_INDEXING_ENABLED==="true"&&siteOrigin(env.NEXT_PUBLIC_APP_URL).protocol==="https:";
}
export function absolutePublicUrl(path:string,origin?:string){
  if(!publicSeoRoutes.includes(path as typeof publicSeoRoutes[number]))throw new Error("NOT_PUBLIC_SEO_ROUTE");
  return new URL(path,siteOrigin(origin)).toString();
}
export function safeJsonLd(data:unknown){
  return JSON.stringify(data).replace(/</g,"\\u003c").replace(/>/g,"\\u003e").replace(/&/g,"\\u0026");
}
