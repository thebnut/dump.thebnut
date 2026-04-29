import type { NextAuthConfig } from "next-auth";

export const authConfig: NextAuthConfig = {
  pages: {
    signIn: "/login",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const path = nextUrl.pathname;

      // Public: login page, project gate + serve, NextAuth endpoints, _next assets
      const isPublic =
        path === "/login" ||
        path.startsWith("/p/") ||
        path.startsWith("/api/auth") ||
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
