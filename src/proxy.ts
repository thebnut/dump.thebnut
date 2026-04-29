import NextAuth from "next-auth";
import { authConfig } from "./lib/auth.config";

export default NextAuth(authConfig).auth;

export const config = {
  // Skip middleware on:
  //   - Next internals + favicon
  //   - /p/  (project file serve has its own auth + logging)
  //   - /api/v1/  (API uses bearer auth, not session cookies)
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|p/|api/v1/).*)",
  ],
};
