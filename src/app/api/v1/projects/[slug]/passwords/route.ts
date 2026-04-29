import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects, projectPasswords } from "@/lib/db/schema";
import { authenticate, jsonError, jsonOk } from "@/lib/api";
import { addProjectPassword } from "@/lib/projects";
import { rateLimit, RL_DEFAULT } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

// GET /api/v1/projects/{slug}/passwords — list labels (no plaintext).
export async function GET(req: NextRequest, { params }: Params) {
  const auth = await authenticate(req);
  if (!("user" in auth)) return auth;
  const rl = rateLimit(`pw:${auth.tokenId}`, RL_DEFAULT);
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

  const rows = await db
    .select({
      id: projectPasswords.id,
      label: projectPasswords.label,
      createdAt: projectPasswords.createdAt,
    })
    .from(projectPasswords)
    .where(eq(projectPasswords.projectId, project.id));

  return jsonOk({
    passwords: rows.map((r) => ({
      id: r.id,
      label: r.label,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}

// POST /api/v1/projects/{slug}/passwords — add a labelled password.
//   JSON body: { label?: string, password: string }
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await authenticate(req);
  if (!("user" in auth)) return auth;
  const rl = rateLimit(`pw:${auth.tokenId}`, RL_DEFAULT);
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

  let body: { label?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonError("missing_field", "Expected JSON body.");
  }
  const password = typeof body.password === "string" ? body.password : "";
  if (!password) return jsonError("missing_field", "password is required.");
  const label =
    typeof body.label === "string" && body.label.trim()
      ? body.label.trim()
      : "default";

  await addProjectPassword(project.id, label, password);
  return jsonOk({ added: true, label }, 201);
}
