import { NextRequest, NextResponse } from "next/server";
import { projectBySlugPublic } from "@/lib/queries";
import { getProjectSheet } from "@/lib/projects";
import { readVerifiedGateCookie } from "@/lib/gate";
import { getClientIp } from "@/lib/util";
import { contentRedirectTarget } from "@/lib/origins";
import { rateLimit, RL_SHEET } from "@/lib/rate-limit";
import {
  sheetRateLimitKey,
  tooManyResponse,
  sheetErrorResponse,
  readSheetBody,
} from "@/lib/sheet-shared";
import { updateRow, removeRow } from "@/lib/sheets";

// Legacy host: 308 to content origin. 308 preserves method + body so PATCH
// payloads survive the redirect.
function redirectIfLegacyHost(req: NextRequest): NextResponse | null {
  const target = contentRedirectTarget(
    req.headers.get("host"),
    req.nextUrl.pathname,
    req.nextUrl.search,
  );
  if (!target) return null;
  const res = NextResponse.redirect(target, 308);
  res.headers.set("Cache-Control", "public, max-age=300");
  return res;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH  /p/<slug>/sheet/rows/<id> — update fields by id
// DELETE /p/<slug>/sheet/rows/<id> — delete by id

type Params = { params: Promise<{ slug: string; id: string }> };

async function loadAndAuth(slug: string) {
  // readVerifiedGateCookie reads from cookies() — no need to thread the
  // request through; the slug is all we need from the call site. The DB
  // check inside it ensures a rotated/deleted password invalidates the
  // session immediately, instead of leaving the user with write access
  // on a revoked credential.
  const project = await projectBySlugPublic(slug);
  if (!project) return { kind: "not_found" as const };
  if (project.expiresAt && project.expiresAt.getTime() <= Date.now()) {
    return { kind: "gone" as const };
  }
  const sheet = await getProjectSheet(project.id);
  if (!sheet) return { kind: "not_found" as const };
  if (project.isProtected) {
    const ok = await readVerifiedGateCookie(project.id);
    if (!ok) return { kind: "unauthorized" as const };
  }
  return { kind: "ok" as const, sheet, projectId: project.id };
}

function statusResponse(kind: "not_found" | "gone" | "unauthorized") {
  const map = { not_found: 404, gone: 410, unauthorized: 401 };
  return NextResponse.json({ error: { code: kind } }, { status: map[kind] });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const legacy = redirectIfLegacyHost(req);
  if (legacy) return legacy;

  const { slug, id } = await params;
  const auth = await loadAndAuth(slug);
  if (auth.kind !== "ok") return statusResponse(auth.kind);

  const rl = rateLimit(sheetRateLimitKey(auth.projectId, getClientIp(req)), RL_SHEET);
  if (!rl.allowed) return tooManyResponse(rl.retryAfterSec);

  const parsed = await readSheetBody(req);
  if (!parsed.ok) return parsed.response;

  try {
    const updated = await updateRow(
      { sheetId: auth.sheet.sheetId, tabName: auth.sheet.tabName },
      id,
      parsed.body,
    );
    if (!updated) {
      return NextResponse.json(
        { error: { code: "row_not_found", id } },
        { status: 404 },
      );
    }
    return NextResponse.json(updated, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return sheetErrorResponse(slug, err);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const legacy = redirectIfLegacyHost(req);
  if (legacy) return legacy;

  const { slug, id } = await params;
  const auth = await loadAndAuth(slug);
  if (auth.kind !== "ok") return statusResponse(auth.kind);

  const rl = rateLimit(sheetRateLimitKey(auth.projectId, getClientIp(req)), RL_SHEET);
  if (!rl.allowed) return tooManyResponse(rl.retryAfterSec);

  try {
    const result = await removeRow(
      { sheetId: auth.sheet.sheetId, tabName: auth.sheet.tabName },
      id,
    );
    if (!result.ok) {
      return NextResponse.json(
        { error: { code: "row_not_found", id } },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { deleted: true, id },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return sheetErrorResponse(slug, err);
  }
}
