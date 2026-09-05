import OAuth2Server from "@node-oauth/oauth2-server";
import { CALLBACK, CLIENT_ID, RESOURCE, hashSecret, newSecret, validScopes } from "./oauth-policy";

export type SavedCode = {
  hash: string; userId: string; scope: string[]; expiresAt: Date;
  challenge: string; resource: string;
};
export type SavedToken = {
  hash: string; refreshHash: string; userId: string; scope: string[];
  accessExpiresAt: Date; refreshExpiresAt: Date; resource: string;
};
export interface OAuthStore {
  saveCode(code: SavedCode): Promise<void>;
  getCode(hash: string): Promise<SavedCode | undefined>;
  consumeCode(hash: string): Promise<boolean>;
  saveToken(token: SavedToken): Promise<void>;
  getToken(hash: string, refresh: boolean): Promise<SavedToken | undefined>;
  revokeToken(hash: string, refresh: boolean): Promise<boolean>;
}

const client = { id: CLIENT_ID, redirectUris: [CALLBACK], grants: ["authorization_code", "refresh_token"] };
export function createOAuthServer(store: OAuthStore) {
  const model: OAuth2Server.AuthorizationCodeModel & OAuth2Server.RefreshTokenModel = {
    async getClient(id, secret) { return id === CLIENT_ID && !secret ? client : false; },
    async generateAccessToken() { return newSecret(); },
    async generateRefreshToken() { return newSecret(); },
    async generateAuthorizationCode() { return newSecret(); },
    async validateScope(_user, _client, scopes) { return validScopes(scopes) ? scopes : false; },
    async verifyScope(token, scopes) { return scopes.every(s => token.scope?.includes(s)); },
    async saveAuthorizationCode(code, _client, user) {
      if (!code.codeChallenge || code.codeChallengeMethod !== "S256" || !validScopes(code.scope)) return false;
      await store.saveCode({ hash: hashSecret(code.authorizationCode), userId: user.id, scope: code.scope, expiresAt: code.expiresAt, challenge: code.codeChallenge, resource: RESOURCE });
      return { ...code, client, user };
    },
    async getAuthorizationCode(code) {
      const row = await store.getCode(hashSecret(code));
      if (!row || row.resource !== RESOURCE) return false;
      return { authorizationCode: code, expiresAt: row.expiresAt, redirectUri: CALLBACK, scope: row.scope, codeChallenge: row.challenge, codeChallengeMethod: "S256", client, user: { id: row.userId } };
    },
    async revokeAuthorizationCode(code) { return store.consumeCode(hashSecret(code.authorizationCode)); },
    async saveToken(token, _client, user) {
      if (!token.refreshToken || !token.accessTokenExpiresAt || !token.refreshTokenExpiresAt || !validScopes(token.scope)) return false;
      await store.saveToken({ hash: hashSecret(token.accessToken), refreshHash: hashSecret(token.refreshToken), userId: user.id, scope: token.scope, accessExpiresAt: token.accessTokenExpiresAt, refreshExpiresAt: token.refreshTokenExpiresAt, resource: RESOURCE });
      return { ...token, client, user };
    },
    async getAccessToken(token) {
      const row = await store.getToken(hashSecret(token), false);
      if (!row || row.resource !== RESOURCE) return false;
      return { accessToken: token, accessTokenExpiresAt: row.accessExpiresAt, scope: row.scope, client, user: { id: row.userId } };
    },
    async getRefreshToken(token) {
      const row = await store.getToken(hashSecret(token), true);
      if (!row || row.resource !== RESOURCE) return false;
      return { refreshToken: token, refreshTokenExpiresAt: row.refreshExpiresAt, scope: row.scope, client, user: { id: row.userId } };
    },
    async revokeToken(token) { return store.revokeToken(hashSecret(token.refreshToken), true); },
  };
  return new OAuth2Server({ model, authorizationCodeLifetime: 300, accessTokenLifetime: 3600, refreshTokenLifetime: 30 * 86400, alwaysIssueNewRefreshToken: true, requireClientAuthentication: { authorization_code: false, refresh_token: false } });
}

export async function exchangeToken(server: OAuth2Server, body: Record<string, string>) {
  // Resource indicators are mandatory on both exchange and refresh. The
  // library handles PKCE, redirect matching, scope reduction and one-use codes.
  if (body.resource !== RESOURCE) throw new OAuth2Server.InvalidRequestError("Invalid resource");
  if (!['authorization_code', 'refresh_token'].includes(body.grant_type)) throw new OAuth2Server.UnsupportedGrantTypeError("Unsupported grant");
  const response = new OAuth2Server.Response();
  const length = Buffer.byteLength(new URLSearchParams(body).toString());
  await server.token(new OAuth2Server.Request({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "content-length": String(length) }, query: {}, body }), response);
  return response;
}
