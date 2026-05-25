import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./lib/auth.config";
import { APP_HOST, CONTENT_HOST } from "./lib/origins";

function isContentPath(path: string): boolean {
  return path.startsWith("/p/") || path.startsWith("/gate/");
}

// Origin split:
//   - Dashboard / login / bearer-auth API → dump.thebnut.com (the "app" host)
//   - Uploaded prototypes + their gate page → content.thebnut.com
//
// Anything landing on content.thebnut.com that ISN'T a prototype path gets
// bounced back to the app origin so the dashboard / login / API surface
// never has to defend itself against same-origin attacks from hosted JS.
//
// The reverse direction (legacy `dump.thebnut.com/p/...` and
// `dump.thebnut.com/gate/...` → content) is NOT handled here. The /p/ route
// handlers issue their own 308 (so file-extension URLs like
// `/p/foo/index.html`, which the matcher would otherwise skip, are covered)
// and the /gate/ page does a `permanentRedirect` at the top for the same
// reason — keeps DB hits and cookie writes on the right origin.
export default NextAuth(authConfig).auth((req) => {
  const host = req.headers.get("host") ?? "";
  const path = req.nextUrl.pathname;

  if (host === CONTENT_HOST && !isContentPath(path)) {
    const url = req.nextUrl.clone();
    url.host = APP_HOST;
    url.protocol = "https:";
    url.port = "";
    const res = NextResponse.redirect(url, 308);
    // Short cache while we shake the migration out; switch to long-lived
    // (or remove) once we're confident no legitimate dashboard traffic
    // ever lands on content.*.
    res.headers.set("Cache-Control", "public, max-age=300");
    return res;
  }

  // Fall through to NextAuth's authorized() callback for everything else.
});

export const config = {
  // Skip middleware on:
  //   - Next internals + favicon
  //   - /p/  (project file serve has its own auth + logging + host redirect)
  //   - /api/v1/  (API uses bearer auth, not session cookies)
  //   - /api/cron/ (scheduled jobs auth via CRON_SECRET bearer; the
  //     proxy was redirecting Vercel-scheduled invocations to /login
  //     before this exclusion existed, so the cron silently never ran)
  //   - any path containing a "." in its last segment — i.e. files with
  //     an extension (logo.svg, dump-thebnut.skill.md, robots.txt, …).
  //     Next.js routes never have dots, so this only catches static
  //     assets in public/ which should always be reachable without auth.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|p/|api/v1/|api/cron/|.*\\.[^/]+$).*)",
  ],
};
