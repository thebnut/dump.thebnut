import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "./db";
import { apiTokens, users, type User } from "./db/schema";
import { hashToken, looksLikeToken } from "./tokens";

export type ApiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "missing_field"
  | "slug_taken"
  | "zip_too_large"
  | "zip_invalid"
  | "rate_limited"
  | "method_not_allowed"
  | "internal_error";

const STATUS: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  missing_field: 400,
  slug_taken: 409,
  zip_too_large: 413,
  zip_invalid: 400,
  rate_limited: 429,
  method_not_allowed: 405,
  internal_error: 500,
};

export function jsonError(code: ApiErrorCode, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status: STATUS[code] },
  );
}

export function jsonOk<T extends object>(body: T, status = 200) {
  return NextResponse.json(body, { status });
}

export type AuthedRequest = {
  user: User;
  tokenId: string;
};

// Verify Authorization: Bearer dt_live_... and update last_used_at.
export async function authenticate(
  req: NextRequest,
): Promise<AuthedRequest | NextResponse> {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return jsonError(
      "unauthorized",
      "Missing or malformed Authorization header. Expected 'Bearer dt_live_…'.",
    );
  }
  const raw = header.slice("Bearer ".length).trim();
  if (!looksLikeToken(raw)) {
    return jsonError("unauthorized", "Invalid token format.");
  }
  const hash = hashToken(raw);

  const rows = await db
    .select({
      tokenId: apiTokens.id,
      userId: apiTokens.userId,
      revokedAt: apiTokens.revokedAt,
      user: users,
    })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(and(eq(apiTokens.tokenHash, hash), isNull(apiTokens.revokedAt)))
    .limit(1);

  const row = rows[0];
  if (!row) return jsonError("unauthorized", "Token is invalid or revoked.");

  // Best-effort: update last_used_at without blocking the request flow.
  db.update(apiTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiTokens.id, row.tokenId))
    .catch(() => {});

  return { user: row.user, tokenId: row.tokenId };
}

// Wrap a route handler with bearer-auth. Returns 401 envelope on failure.
export function withAuth<Ctx>(
  handler: (req: NextRequest, ctx: Ctx, auth: AuthedRequest) => Promise<NextResponse>,
) {
  return async (req: NextRequest, ctx: Ctx): Promise<NextResponse> => {
    const auth = await authenticate(req);
    if (auth instanceof NextResponse) return auth;
    return handler(req, ctx, auth);
  };
}

// Project shape returned by the API. Stable contract — be careful changing.
export function serializeProject(p: {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  entryPath: string;
  isProtected: boolean;
  createdAt: Date;
  updatedAt: Date;
}, baseUrl: string, accessCount?: number) {
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    description: p.description,
    entryPath: p.entryPath,
    isProtected: p.isProtected,
    url: `${baseUrl}/p/${p.slug}/`,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    ...(accessCount !== undefined ? { accessCount } : {}),
  };
}

export function siteUrl(req: NextRequest): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "");
  if (env) return env;
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("host") ?? "dump.thebnut.com";
  return `${proto}://${host}`;
}
