import { oauth, oauthStore } from "@/lib/oauth-db";
import { exchangeToken } from "@/lib/oauth-server";
import { CALLBACK, CLIENT_ID, SCOPES, hashSecret, singleParams, OAuthRequestError } from "@/lib/oauth-policy";
import { boundedText, oauthError, oauthHeaders, oauthRateLimit, options } from "@/lib/oauth-http";

export const runtime = "nodejs";
export const OPTIONS = options;
export async function POST(req: Request, { params }: { params: Promise<{ operation: string }> }) {
  const { operation } = await params;
  if (!["register", "token", "revoke"].includes(operation)) return new Response(null, { status: 404 });
  const limited = oauthRateLimit(req);
  if (!limited.allowed) return Response.json({ error: "temporarily_unavailable" }, { status: 429, headers: { ...oauthHeaders, "Retry-After": String(limited.retryAfterSec) } });
  try {
    if (operation === "register") {
      if (!req.headers.get("content-type")?.startsWith("application/json")) throw new OAuthRequestError("JSON required");
      const body = JSON.parse(await boundedText(req));
      // A single pre-registered public client: no untrusted callback registration,
      // arbitrary metadata fetch, generated client secrets or registration DB spam.
      if (!Array.isArray(body?.redirect_uris) || body.redirect_uris.length !== 1 || body.redirect_uris[0] !== CALLBACK || (body.token_endpoint_auth_method && body.token_endpoint_auth_method !== "none")) throw new OAuthRequestError("Unsupported client registration");
      return Response.json({ client_id: CLIENT_ID, client_name: "ChatGPT", redirect_uris: [CALLBACK], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], scope: SCOPES.join(" ") }, { status: 201, headers: oauthHeaders });
    }
    if (!req.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) throw new OAuthRequestError("Form encoding required");
    const body = singleParams(new URLSearchParams(await boundedText(req)));
    if (operation === "revoke") {
      if (body.client_id !== CLIENT_ID || !body.token || body.client_secret) throw new OAuthRequestError("Invalid revocation");
      const hash = hashSecret(body.token);
      await oauthStore.revokeToken(hash, true);
      await oauthStore.revokeToken(hash, false);
      return new Response(null, { status: 200, headers: oauthHeaders });
    }
    const response = await exchangeToken(oauth, body);
    return Response.json(response.body, { status: response.status ?? 200, headers: { ...response.headers, ...oauthHeaders } });
  } catch (error) { return oauthError(error instanceof SyntaxError ? new OAuthRequestError("Invalid JSON") : error); }
}
