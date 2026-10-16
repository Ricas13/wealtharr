import type { Metadata, Viewport } from "next";
import {siteOrigin,publicIndexingEnabled} from "@/lib/public-seo";
import { ensureSettings } from "@/lib/settings";
import { PwaRegister } from "@/components/PwaRegister";
import {ResearchDisclaimer} from "@/components/ResearchDisclaimer";
import "./globals.css";

// SEO indexing is an operational release gate. Resolve runtime environment on Oracle Docker.
export const dynamic="force-dynamic";

// viewport-fit=cover lets the page use the whole screen on phones with a notch or home bar; the
// stylesheet then keeps content clear of them with env(safe-area-inset-*).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#07111f" },
    { media: "(prefers-color-scheme: light)", color: "#f4f7fb" }
  ]
};

// Resolved per request: brand, public address and indexing come from the admin settings.
export async function generateMetadata(): Promise<Metadata> {
  await ensureSettings();
  const brand=process.env.NEXT_PUBLIC_BRAND_NAME?.trim()||"Wealtharr";
  const origin=siteOrigin(process.env.NEXT_PUBLIC_APP_URL);
  return {
  metadataBase:origin,
  applicationName:brand,
  title:{default:brand+" | Rules-Based Portfolio Tracker",template:"%s | "+brand},
  description:"Track self-selected investment strategies, portfolio prices, scheduled reviews, and rules-based rebalancing. Transparent calculations and user-confirmed trades.",
  openGraph:{type:"website",locale:"en_GB",siteName:brand,url:"/",title:brand+" | Rules-Based Portfolio Tracker",
    description:"Track portfolio strategies, scheduled reviews and transparent rebalance calculations."},
  twitter:{card:"summary",title:brand+" | Rules-Based Portfolio Tracker",description:"Keep track of your investment strategies and review dates."},
  robots:publicIndexingEnabled(process.env)?{index:true,follow:true}:{index:false,follow:false,noarchive:true},
  verification:process.env.GOOGLE_SITE_VERIFICATION?{google:process.env.GOOGLE_SITE_VERIFICATION}:undefined,
  category:"finance",
  manifest:"/manifest.webmanifest",
  icons:{icon:[{url:"/pwa-icon/192",sizes:"192x192",type:"image/png"},{url:"/pwa-icon/512",sizes:"512x512",type:"image/png"}],apple:[{url:"/pwa-icon/180",sizes:"180x180",type:"image/png"}]},
  appleWebApp:{capable:true,title:brand,statusBarStyle:"black-translucent"},
  formatDetection:{telephone:false,address:false,email:false},
};
}

const themeScript = `
(() => {
  try {
    const saved = (localStorage.getItem("wealtharr-theme") ?? localStorage.getItem("rebalune-theme") ?? localStorage.getItem("strategyos-theme"));
    const theme = saved === "light" || saved === "dark"
      ? saved
      : (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch {
    document.documentElement.dataset.theme = "dark";
    document.documentElement.style.colorScheme = "dark";
  }
})();
`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await ensureSettings();
  return <html lang="en" suppressHydrationWarning>
    <head><script dangerouslySetInnerHTML={{__html:themeScript}}/></head>
    <body>{children}<ResearchDisclaimer/><PwaRegister/></body>
  </html>;
}
