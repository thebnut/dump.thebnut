import NextAuth from "next-auth";
import { authConfig } from "./lib/auth.config";

export default NextAuth(authConfig).auth;

export const config = {
  // Skip middleware on:
  //   - Next internals + favicon
  //   - /p/  (project file serve has its own auth + logging)
  //   - /api/v1/  (API uses bearer auth, not session cookies)
  //   - any path containing a "." in its last segment — i.e. files with
  //     an extension (logo.svg, dump-thebnut.skill.md, robots.txt, …).
  //     Next.js routes never have dots, so this only catches static
  //     assets in public/ which should always be reachable without auth.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|p/|api/v1/|.*\\.[^/]+$).*)",
  ],
};
