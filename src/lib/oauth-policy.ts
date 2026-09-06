import { createHash, randomBytes } from "node:crypto";

// Pin the issuer and audience; never derive either from forwarded headers.
export const ISSUER = "https://dump.thebnut.com";
export const RESOURCE = `${ISSUER}/mcp`;
export const CLIENT_ID = "chatgpt";
export const CALLBACK = "https://chatgpt.com/connector_platform_oauth_redirect";
export const SCOPES = ["projects:read", "projects:write"];
export class OAuthRequestError extends Error { name = "invalid_request"; code = 400; }
export const hashSecret = (value: string) => createHash("sha256").update(value).digest("hex");
export const newSecret = () => randomBytes(32).toString("base64url");

export function localCallback(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\x00-\x20]/.test(value)) return "/";
  const url = new URL(value, ISSUER);
  return url.origin === ISSUER ? url.pathname + url.search : "/";
}

export function singleParams(params: URLSearchParams): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of params) {
    if (Object.hasOwn(result, key) || value.length > 4096) throw new OAuthRequestError("Invalid or duplicate OAuth parameter");
    result[key] = value;
  }
  return result;
}

export function validScopes(scopes: string[] | undefined): scopes is string[] {
  return !!scopes?.length && scopes.every((scope) => SCOPES.includes(scope));
}

export function validateAuthorization(query: Record<string, string>) {
  if (query.client_id !== CLIENT_ID || query.redirect_uri !== CALLBACK || query.response_type !== "code") throw new Error("Invalid client or redirect URI");
  if (query.resource !== RESOURCE) throw new Error("The requested resource is not this publisher");
  if (query.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(query.code_challenge ?? "")) throw new Error("S256 PKCE is required");
  if (!query.state || query.state.length > 1024) throw new Error("OAuth state is required");
  const scope = query.scope?.split(" ");
  if (!validScopes(scope)) throw new Error("Request projects:read and/or projects:write");
  return scope;
}

export const oauthMetadata = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/oauth/authorize`,
  token_endpoint: `${ISSUER}/oauth/token`,
  revocation_endpoint: `${ISSUER}/oauth/revoke`,
  registration_endpoint: `${ISSUER}/oauth/register`,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  token_endpoint_auth_methods_supported: ["none"],
  code_challenge_methods_supported: ["S256"],
  scopes_supported: SCOPES,
  authorization_response_iss_parameter_supported: true,
};
