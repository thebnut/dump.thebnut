import { NextRequest } from "next/server";
import { eq, sql, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  projects,
  accessLogs,
} from "@/lib/db/schema";
import {
  authenticate,
  jsonError,
  jsonOk,
  serializeProject,
  siteUrl,
} from "@/lib/api";
import {
  createProject,
  SlugTakenError,
  ZipError,
} from "@/lib/projects";
import { rateLimit, RL_DEFAULT, RL_UPLOAD } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/v1/projects — list projects owned by the authed user
export async function GET(req: NextRequest) {
  const auth = await authenticate(req);
  if (!("user" in auth)) return auth;

  const rl = rateLimit(`list:${auth.tokenId}`, RL_DEFAULT);
  if (!rl.allowed) {
    return jsonError(
      "rate_limited",
      `Too many requests. Retry in ${rl.retryAfterSec}s.`,
    );
  }

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
      accessCount: sql<number>`coalesce(count(${accessLogs.id}), 0)::int`,
    })
    .from(projects)
    .leftJoin(accessLogs, eq(accessLogs.projectId, projects.id))
    .where(eq(projects.ownerId, auth.user.id))
    .groupBy(projects.id)
    .orderBy(desc(projects.updatedAt));

  const base = siteUrl(req);
  return jsonOk({
    projects: rows.map((r) => serializeProject(r, base, r.accessCount)),
  });
}

// POST /api/v1/projects — create from multipart/form-data
//   fields: title (required), zip (required, file),
//           slug, description, entryPath,
//           password, passwordLabel
export async function POST(req: NextRequest) {
  const auth = await authenticate(req);
  if (!("user" in auth)) return auth;

  const rl = rateLimit(`upload:${auth.tokenId}`, RL_UPLOAD);
  if (!rl.allowed) {
    return jsonError(
      "rate_limited",
      `Too many uploads. Retry in ${rl.retryAfterSec}s.`,
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(
      "missing_field",
      "Expected multipart/form-data body with a 'zip' file part.",
    );
  }

  const title = String(form.get("title") ?? "").trim();
  if (!title) return jsonError("missing_field", "title is required.");

  // Accept the canonical `file` field; fall back to `zip` for back-compat.
  const upload = form.get("file") ?? form.get("zip");
  if (!(upload instanceof File) || upload.size === 0) {
    return jsonError(
      "missing_field",
      "file is required (a .zip or a single .html).",
    );
  }

  const slug = String(form.get("slug") ?? "").trim() || undefined;
  const description = String(form.get("description") ?? "").trim() || null;
  const entryPath = String(form.get("entryPath") ?? "").trim() || undefined;
  const password = String(form.get("password") ?? "").trim();
  const passwordLabel =
    String(form.get("passwordLabel") ?? "").trim() || "default";

  try {
    const buf = await upload.arrayBuffer();
    const project = await createProject({
      ownerId: auth.user.id,
      title,
      slug,
      description,
      entryPath,
      zipBuffer: buf,
      originalFilename: upload.name,
      passwords: password ? [{ label: passwordLabel, password }] : undefined,
      collisionMode: "reject",
    });
    return jsonOk(
      { project: serializeProject(project, siteUrl(req), 0) },
      201,
    );
  } catch (e) {
    if (e instanceof SlugTakenError) {
      return jsonError("slug_taken", e.message);
    }
    if (e instanceof ZipError) {
      const tooBig = /max total size|max file count/i.test(e.message);
      return jsonError(tooBig ? "zip_too_large" : "zip_invalid", e.message);
    }
    console.error("[api] POST /projects failed", e);
    return jsonError("internal_error", "Project creation failed.");
  }
}
