import { auth } from "@/auth";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

// Route gate for the signed-in areas only. This file must live in src/ (the app directory is
// src/app); a copy at the repository root is silently ignored by Next.js. Marketing and SEO pages,
// the auth pages and robots/sitemap are deliberately not matched, so they stay public. API routes
// are not matched either: every handler authenticates itself and answers 401/403 as JSON.
// Revoked sessions (for example after a password reset) are detected by requirePageUser, which
// needs the database and therefore cannot run here.
// The auth configuration is built per request (so provider settings saved in the admin screen apply
// without a restart), which makes `auth(callback)` resolve to the real handler asynchronously.
const gate = auth((request) => {
  if (!request.auth) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }
  // Fail closed on the admin area: only a token that says ADMIN gets through. This is a cheap first
  // line (the role is the one in the token); requireAdminPage on every admin page and requireAdmin
  // on every admin API remain the authoritative check against the database.
  const path = request.nextUrl.pathname;
  if ((path === "/admin" || path.startsWith("/admin/")) && request.auth.user?.role !== "ADMIN") {
    return NextResponse.redirect(new URL("/app", request.url));
  }
  return NextResponse.next();
});

export async function proxy(request: NextRequest, event: NextFetchEvent) {
  const handler = (await gate) as unknown as (request: NextRequest, event: NextFetchEvent) => Promise<Response>;
  return handler(request, event);
}

export const config = {
  matcher: ["/app/:path*", "/admin/:path*"]
};
