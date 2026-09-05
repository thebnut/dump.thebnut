import type { NextAuthConfig } from "next-auth";

export const authConfig: NextAuthConfig = {
  pages: {
    signIn: "/login",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const path = nextUrl.pathname;

      // Public: login page, project gate + serve, NextAuth endpoints,
      // bearer-auth API (route handlers do their own auth), cron routes
      // (auth via CRON_SECRET in their own handler), docs page, _next
      // assets, favicon.
      const isPublic =
        path === "/login" ||
        path === "/mcp" ||
        path.startsWith("/.well-known/") ||
        path.startsWith("/oauth/") ||
        path === "/api" ||
        path.startsWith("/p/") ||
        path.startsWith("/gate/") ||
        path.startsWith("/api/auth") ||
        path.startsWith("/api/v1") ||
        path.startsWith("/api/cron") ||
        path.startsWith("/_next") ||
        path === "/favicon.ico";

      if (isPublic) return true;
      if (!isLoggedIn) return false;

      // Admin gate
      if (path.startsWith("/admin") || path.startsWith("/api/admin")) {
        return auth?.user?.role === "admin";
      }
      return true;
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = (user as { role?: string }).role ?? "user";
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
      }
      return session;
    },
  },
  providers: [],
};
