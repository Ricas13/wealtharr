import type {MetadataRoute} from "next";
import {ensureSettings} from "@/lib/settings";
export const dynamic="force-dynamic";
import {absolutePublicUrl,privateRoutePrefixes,publicIndexingEnabled} from "@/lib/public-seo";
export default async function robots():Promise<MetadataRoute.Robots>{
  await ensureSettings();
  if(!publicIndexingEnabled(process.env))return {rules:{userAgent:"*",disallow:"/"}};
  return {rules:{userAgent:"*",allow:"/",disallow:[...privateRoutePrefixes]},sitemap:absolutePublicUrl("/",process.env.NEXT_PUBLIC_APP_URL)+"sitemap.xml"};
}
