import type {MetadataRoute} from "next";
import {ensureSettings} from "@/lib/settings";
export const dynamic="force-dynamic";
import {absolutePublicUrl,publicIndexingEnabled,publicSeoRoutes} from "@/lib/public-seo";
export default async function sitemap():Promise<MetadataRoute.Sitemap>{
  await ensureSettings();
  if(!publicIndexingEnabled(process.env))return [];
  return publicSeoRoutes.map(path=>({url:absolutePublicUrl(path,process.env.NEXT_PUBLIC_APP_URL),
    changeFrequency:path==="/"?"weekly":"monthly",priority:path==="/"?1:0.65}));
}
