import { rateLimit } from "./rate-limit";
import OAuth2Server from "@node-oauth/oauth2-server";
import { OAuthRequestError } from "./oauth-policy";

export const oauthHeaders = { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" };
export function oauthError(error: unknown) {
  const known = error instanceof OAuth2Server.OAuthError || error instanceof OAuthRequestError;
  const status = known && error.code >= 400 && error.code < 600 ? error.code : 500;
  return Response.json({ error: status >= 500 ? "server_error" : (error as Error).name, error_description: status >= 500 ? "Request failed" : "Invalid OAuth request" }, { status, headers: oauthHeaders });
}
export async function boundedText(req: Request, max = 16384) {
  if (Number(req.headers.get("content-length")) > max) throw new OAuthRequestError("Request too large");
  const reader = req.body?.getReader();
  if (!reader) return "";
  const parts: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > max) { await reader.cancel(); throw new OAuthRequestError("Request too large"); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(parts).toString("utf8");
}
export function oauthRateLimit(req: Request) {
  const ip = req.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  return rateLimit(`oauth:${ip}`, { capacity: 30, refillPerSec: 0.5 });
}
export function options() { return new Response(null, { status: 204, headers: { ...oauthHeaders, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" } }); }
