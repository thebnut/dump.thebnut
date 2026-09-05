import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "./db";
import { oauthCodes, oauthTokens } from "./db/schema";
import { createOAuthServer, type OAuthStore } from "./oauth-server";

export const oauthStore: OAuthStore = {
  async saveCode(code) { await db.insert(oauthCodes).values(code); },
  async getCode(hash) { return (await db.select().from(oauthCodes).where(eq(oauthCodes.hash, hash)).limit(1))[0]; },
  async consumeCode(hash) {
    const rows = await db.delete(oauthCodes).where(and(eq(oauthCodes.hash, hash), gt(oauthCodes.expiresAt, new Date()))).returning({ hash: oauthCodes.hash });
    return rows.length === 1;
  },
  async saveToken(token) { await db.insert(oauthTokens).values(token); },
  async getToken(hash, refresh) {
    return (await db.select().from(oauthTokens).where(and(eq(refresh ? oauthTokens.refreshHash : oauthTokens.hash, hash), isNull(oauthTokens.revokedAt))).limit(1))[0];
  },
  async revokeToken(hash, refresh) {
    const rows = await db.update(oauthTokens).set({ revokedAt: new Date() }).where(and(eq(refresh ? oauthTokens.refreshHash : oauthTokens.hash, hash), isNull(oauthTokens.revokedAt))).returning({ hash: oauthTokens.hash });
    return rows.length === 1;
  },
};
export const oauth = createOAuthServer(oauthStore);
