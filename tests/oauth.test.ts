import { describe, expect, it } from "vitest";
import OAuth2Server from "@node-oauth/oauth2-server";
import { createHash } from "node:crypto";
import { createOAuthServer, exchangeToken, type OAuthStore, type SavedCode, type SavedToken } from "../src/lib/oauth-server";
import { CALLBACK, CLIENT_ID, RESOURCE, hashSecret, localCallback, singleParams, validateAuthorization } from "../src/lib/oauth-policy";

class MemoryStore implements OAuthStore {
  codes = new Map<string, SavedCode>(); tokens = new Map<string, SavedToken>();
  async saveCode(row: SavedCode) { this.codes.set(row.hash, row); }
  async getCode(hash: string) { return this.codes.get(hash); }
  async consumeCode(hash: string) { const row = this.codes.get(hash); return !!row && row.expiresAt > new Date() && this.codes.delete(hash); }
  async saveToken(row: SavedToken) { this.tokens.set(row.hash, row); }
  async getToken(hash: string, refresh: boolean) { return refresh ? [...this.tokens.values()].find(t => t.refreshHash === hash) : this.tokens.get(hash); }
  async revokeToken(hash: string, refresh: boolean) { const row = await this.getToken(hash, refresh); return !!row && this.tokens.delete(row.hash); }
}
const verifier = "a".repeat(43);
const query = { client_id: CLIENT_ID, redirect_uri: CALLBACK, response_type: "code", resource: RESOURCE, state: "independent-state", scope: "projects:read projects:write", code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url") };
async function fixture(overrides: Record<string, string> = {}) {
  const store = new MemoryStore(); const server = createOAuthServer(store);
  const q = { ...query, ...overrides }; validateAuthorization(q);
  const code = await server.authorize(new OAuth2Server.Request({ method: "GET", headers: {}, query: q }), new OAuth2Server.Response(), { authenticateHandler: { handle: async () => ({ id: "owner-a" }) } });
  const body = { grant_type: "authorization_code", client_id: CLIENT_ID, redirect_uri: CALLBACK, code: code.authorizationCode, code_verifier: verifier, resource: RESOURCE };
  return { store, server, body };
}
describe("OAuth authorization and token exchange", () => {
  it("issues scoped, expiring tokens while storing only digests", async () => {
    const { store, server, body } = await fixture();
    expect(JSON.stringify([...store.codes])).not.toContain(body.code);
    const response = await exchangeToken(server, body);
    expect(response.body.token_type).toBe("Bearer");
    expect(response.body.expires_in).toBeGreaterThan(3500);
    expect(response.body.scope).toBe("projects:read projects:write");
    expect(JSON.stringify([...store.tokens])).not.toContain(response.body.access_token);
    expect(JSON.stringify([...store.tokens])).not.toContain(response.body.refresh_token);
    expect(store.codes.size).toBe(0);
    expect([...store.tokens.values()][0].userId).toBe("owner-a");
  });
  it("rejects the wrong PKCE verifier and consumes the code", async () => {
    const { server, body } = await fixture();
    await expect(exchangeToken(server, { ...body, code_verifier: "b".repeat(43) })).rejects.toThrow();
    await expect(exchangeToken(server, body)).rejects.toThrow();
  });
  it("rejects code replay, including concurrent exchanges", async () => {
    const { server, body } = await fixture();
    const outcomes = await Promise.allSettled([exchangeToken(server, body), exchangeToken(server, body)]);
    expect(outcomes.filter(r => r.status === "fulfilled")).toHaveLength(1);
  });
  it("rejects another resource, wrong callback and wrong client", async () => {
    for (const override of [{ resource: "https://evil.example/mcp" }, { redirect_uri: "https://evil.example" }, { client_id: "other-client" }]) {
      const { server, body } = await fixture();
      await expect(exchangeToken(server, { ...body, ...override })).rejects.toThrow();
    }
  });
  it("rejects expired codes", async () => {
    const { store, server, body } = await fixture();
    store.codes.get(hashSecret(body.code))!.expiresAt = new Date(0);
    await expect(exchangeToken(server, body)).rejects.toThrow();
  });
  it("rotates refresh tokens, reduces scope and rejects reuse", async () => {
    const { server, body } = await fixture();
    const first = (await exchangeToken(server, body)).body;
    const refresh = { grant_type: "refresh_token", client_id: CLIENT_ID, resource: RESOURCE, refresh_token: first.refresh_token, scope: "projects:read" };
    const next = (await exchangeToken(server, refresh)).body;
    expect(next.refresh_token).not.toBe(first.refresh_token);
    expect(next.scope).toBe("projects:read");
    await expect(exchangeToken(server, refresh)).rejects.toThrow();
    await expect(exchangeToken(server, { ...refresh, refresh_token: next.refresh_token, scope: "projects:read projects:write" })).rejects.toThrow();
  });
  it("rejects expired and revoked refresh tokens", async () => {
    for (const revoke of [false, true]) {
      const { store, server, body } = await fixture();
      const token = (await exchangeToken(server, body)).body;
      if (revoke) await store.revokeToken(hashSecret(token.refresh_token), true);
      else [...store.tokens.values()][0].refreshExpiresAt = new Date(0);
      await expect(exchangeToken(server, { grant_type: "refresh_token", client_id: CLIENT_ID, resource: RESOURCE, refresh_token: token.refresh_token })).rejects.toThrow();
    }
  });
});
describe("OAuth request policy", () => {
  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "/\nevil.example", undefined])("rejects unsafe login callback %s", value => { expect(localCallback(value)).toBe("/"); });
  it("preserves a safe local return destination", () => { expect(localCallback("/oauth/authorize?a=b")).toBe("/oauth/authorize?a=b"); });
  it("rejects duplicate parameters", () => { expect(() => singleParams(new URLSearchParams("resource=a&resource=b"))).toThrow(); });
  it.each([{ code_challenge_method: "plain" }, { code_challenge: "short" }, { state: "" }, { scope: "admin" }, { redirect_uri: CALLBACK + "?next=elsewhere" }, { resource: RESOURCE + "/" }])("rejects invalid authorization %j", override => { expect(() => validateAuthorization({ ...query, ...override })).toThrow(); });
});
