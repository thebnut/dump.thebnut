import { ISSUER, RESOURCE, SCOPES } from "@/lib/oauth-policy";
import { oauthHeaders, options } from "@/lib/oauth-http";
export function GET() { return Response.json({ resource: RESOURCE, authorization_servers: [ISSUER], scopes_supported: SCOPES, bearer_methods_supported: ["header"] }, { headers: oauthHeaders }); }
export const OPTIONS = options;
