import { oauthMetadata } from "@/lib/oauth-policy";
import { oauthHeaders, options } from "@/lib/oauth-http";
export function GET() { return Response.json(oauthMetadata, { headers: oauthHeaders }); }
export const OPTIONS = options;
