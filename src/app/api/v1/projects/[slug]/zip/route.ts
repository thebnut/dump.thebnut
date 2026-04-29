import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import {
  authenticate,
  jsonError,
  jsonOk,
  serializeProject,
  siteUrl,
} from "@/lib/api";
import { replaceProjectFiles, ZipError } from "@/lib/projects";
import { rateLimit, RL_UPLOAD } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

// POST /api/v1/projects/{slug}/zip — wipe + replace files for an existing project.
//   multipart fields: zip (required, file), entryPath (optional)
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await authenticate(req);
  if (!("user" in auth)) return auth;
  const rl = rateLimit(`upload:${auth.tokenId}`, RL_UPLOAD);
  if (!rl.allowed)
    return jsonError(
      "rate_limited",
      `Too many uploads. Retry in ${rl.retryAfterSec}s.`,
    );

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

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(
      "missing_field",
      "Expected multipart/form-data body with a 'zip' file part.",
    );
  }

  const upload = form.get("file") ?? form.get("zip");
  if (!(upload instanceof File) || upload.size === 0) {
    return jsonError(
      "missing_field",
      "file is required (a .zip or a single .html).",
    );
  }
  const entryHint = String(form.get("entryPath") ?? "").trim() || undefined;

  try {
    const buf = await upload.arrayBuffer();
    const updated = await replaceProjectFiles(
      project.id,
      buf,
      entryHint,
      upload.name,
    );
    return jsonOk({
      project: serializeProject(updated, siteUrl(req)),
      replaced: true,
    });
  } catch (e) {
    if (e instanceof ZipError) {
      const tooBig = /max total size|max file count/i.test(e.message);
      return jsonError(tooBig ? "zip_too_large" : "zip_invalid", e.message);
    }
    console.error("[api] POST /projects/{slug}/zip failed", e);
    return jsonError("internal_error", "Re-upload failed.");
  }
}
