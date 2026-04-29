import { NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects, accessLogs } from "@/lib/db/schema";
import {
  authenticate,
  jsonError,
  jsonOk,
  serializeProject,
  siteUrl,
} from "@/lib/api";
import { deleteProject, updateProject } from "@/lib/projects";
import { rateLimit, RL_DEFAULT } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

async function loadOwned(slug: string, userId: string) {
  const rows = await db
    .select({
      id: projects.id,
      slug: projects.slug,
      title: projects.title,
      description: projects.description,
      entryPath: projects.entryPath,
      isProtected: projects.isProtected,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      ownerId: projects.ownerId,
      accessCount: sql<number>`coalesce(count(${accessLogs.id}), 0)::int`,
    })
    .from(projects)
    .leftJoin(accessLogs, eq(accessLogs.projectId, projects.id))
    .where(eq(projects.slug, slug))
    .groupBy(projects.id)
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.ownerId !== userId) return "forbidden" as const;
  return row;
}

export async function GET(req: NextRequest, { params }: Params) {
  const auth = await authenticate(req);
  if (!("user" in auth)) return auth;
  const rl = rateLimit(`get:${auth.tokenId}`, RL_DEFAULT);
  if (!rl.allowed)
    return jsonError("rate_limited", `Retry in ${rl.retryAfterSec}s.`);

  const { slug } = await params;
  const project = await loadOwned(slug, auth.user.id);
  if (!project) return jsonError("not_found", `No project with slug '${slug}'.`);
  if (project === "forbidden")
    return jsonError("forbidden", "You do not own this project.");

  return jsonOk({
    project: serializeProject(project, siteUrl(req), project.accessCount),
  });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await authenticate(req);
  if (!("user" in auth)) return auth;
  const rl = rateLimit(`patch:${auth.tokenId}`, RL_DEFAULT);
  if (!rl.allowed)
    return jsonError("rate_limited", `Retry in ${rl.retryAfterSec}s.`);

  const { slug } = await params;
  const project = await loadOwned(slug, auth.user.id);
  if (!project) return jsonError("not_found", `No project with slug '${slug}'.`);
  if (project === "forbidden")
    return jsonError("forbidden", "You do not own this project.");

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonError("missing_field", "Expected JSON body.");
  }

  await updateProject(project.id, {
    title: typeof body.title === "string" ? body.title : undefined,
    description:
      typeof body.description === "string"
        ? body.description
        : body.description === null
          ? null
          : undefined,
    entryPath:
      typeof body.entryPath === "string" ? body.entryPath : undefined,
  });

  // Re-load to return canonical state.
  const updated = await loadOwned(slug, auth.user.id);
  if (!updated || updated === "forbidden")
    return jsonError("internal_error", "Project disappeared after update.");
  return jsonOk({
    project: serializeProject(updated, siteUrl(req), updated.accessCount),
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const auth = await authenticate(req);
  if (!("user" in auth)) return auth;
  const rl = rateLimit(`del:${auth.tokenId}`, RL_DEFAULT);
  if (!rl.allowed)
    return jsonError("rate_limited", `Retry in ${rl.retryAfterSec}s.`);

  const { slug } = await params;
  const project = await loadOwned(slug, auth.user.id);
  if (!project) return jsonError("not_found", `No project with slug '${slug}'.`);
  if (project === "forbidden")
    return jsonError("forbidden", "You do not own this project.");

  await deleteProject(project.id);
  return jsonOk({ deleted: true, slug });
}
