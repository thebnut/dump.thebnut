import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { authenticate, jsonError, jsonOk } from "@/lib/api";
import {
  removeProjectPassword,
  updateProjectPassword,
} from "@/lib/projects";
import { rateLimit, RL_DEFAULT } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; id: string }> };

async function loadOwned(slug: string, userId: string) {
  const found = await db
    .select()
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  const project = found[0];
  if (!project) return "not_found" as const;
  if (project.ownerId !== userId) return "forbidden" as const;
  return project;
}

// PATCH /api/v1/projects/{slug}/passwords/{id} — change the value
//   JSON body: { password: string }
export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await authenticate(req);
  if (!("user" in auth)) return auth;
  const rl = rateLimit(`pw:${auth.tokenId}`, RL_DEFAULT);
  if (!rl.allowed)
    return jsonError("rate_limited", `Retry in ${rl.retryAfterSec}s.`);

  const { slug, id } = await params;
  const project = await loadOwned(slug, auth.user.id);
  if (project === "not_found")
    return jsonError("not_found", `No project with slug '${slug}'.`);
  if (project === "forbidden")
    return jsonError("forbidden", "You do not own this project.");

  let body: { password?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonError("missing_field", "Expected JSON body.");
  }
  const password = typeof body.password === "string" ? body.password : "";
  if (!password)
    return jsonError("missing_field", "password is required.");

  await updateProjectPassword(project.id, id, password);
  return jsonOk({ updated: true, id });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const auth = await authenticate(req);
  if (!("user" in auth)) return auth;
  const rl = rateLimit(`pw:${auth.tokenId}`, RL_DEFAULT);
  if (!rl.allowed)
    return jsonError("rate_limited", `Retry in ${rl.retryAfterSec}s.`);

  const { slug, id } = await params;
  const project = await loadOwned(slug, auth.user.id);
  if (project === "not_found")
    return jsonError("not_found", `No project with slug '${slug}'.`);
  if (project === "forbidden")
    return jsonError("forbidden", "You do not own this project.");

  await removeProjectPassword(project.id, id);
  return jsonOk({ deleted: true, id });
}
