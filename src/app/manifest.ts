import type { MetadataRoute } from "next";
import { ensureSettings } from "@/lib/settings";

// Makes the site installable ("Add to Home Screen") and is what the native app stores' PWA tooling
// reads. Name comes from the admin settings.
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  await ensureSettings();
  const brand = process.env.NEXT_PUBLIC_BRAND_NAME?.trim() || "Wealtharr";
  return {
    id: "/app",
    name: brand,
    short_name: brand.length > 12 ? brand.slice(0, 12) : brand,
    description: "Rules-based portfolio tracker: your strategies, review dates and rebalance calculations.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#070b14",
    theme_color: "#070b14",
    categories: ["finance"],
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/maskable-512", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ],
    shortcuts: [
      { name: "Portfolio", url: "/app/strategies", icons: [{ src: "/pwa-icon/192", sizes: "192x192" }] },
      { name: "Activity", url: "/app/notifications", icons: [{ src: "/pwa-icon/192", sizes: "192x192" }] }
    ]
  };
}
