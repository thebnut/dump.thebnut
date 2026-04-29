import { NextRequest } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects, accessLogs } from "@/lib/db/schema";
import { authenticate, jsonError, jsonOk } from "@/lib/api";
import { rateLimit, RL_DEFAULT } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

// GET /api/v1/projects/{slug}/logs?limit=200 — most-recent first.
export async function GET(req: NextRequest, { params }: Params) {
  const auth = await authenticate(req);
  if (!("user" in auth)) return auth;
  const rl = rateLimit(`logs:${auth.tokenId}`, RL_DEFAULT);
  if (!rl.allowed)
    return jsonError("rate_limited", `Retry in ${rl.retryAfterSec}s.`);

  const { slug } = await params;
  const found = await db
    .select()
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  const project = found[0];
  if (!project) return jsonError("not_found", `No project with slug '${slug}'.`);
  if (project.ownerId !== auth.user.id)
    return jsonError("forbidden", "You do not own this project.");

  const url = new URL(req.url);
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "200", 10);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(limitRaw, 1), 1000)
    : 200;

  const rows = await db
    .select()
    .from(accessLogs)
    .where(eq(accessLogs.projectId, project.id))
    .orderBy(desc(accessLogs.ts))
    .limit(limit);

  return jsonOk({
    logs: rows.map((l) => ({
      id: l.id,
      ts: l.ts.toISOString(),
      ip: l.ip,
      userAgent: l.userAgent,
      path: l.path,
      passwordLabel: l.passwordLabelUsed,
    })),
  });
}
