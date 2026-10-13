import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    const noIndexRoutes=["/admin/:path*","/app/:path*","/api/:path*","/login","/register","/reset-password","/verify-email","/demo"];
    // The service worker must always be fetched fresh so an updated one is picked up promptly.
    const serviceWorker={source:"/sw.js",headers:[{key:"Cache-Control",value:"no-cache, no-store, must-revalidate"},{key:"Service-Worker-Allowed",value:"/"},{key:"Content-Type",value:"application/javascript; charset=utf-8"}]};
    return [serviceWorker,...noIndexRoutes.map(source=>({source,headers:[{key:"X-Robots-Tag",value:"noindex, nofollow, noarchive"}]})),{
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        { key: "Content-Security-Policy", value: "base-uri 'self'; frame-ancestors 'none'; object-src 'none'; frame-src 'self' https://challenges.cloudflare.com" }
      ]
    }];
  }
};

export default nextConfig;
