import { NextRequest, NextResponse } from "next/server";
import { projectBySlugPublic } from "@/lib/queries";
import { getProjectSheet } from "@/lib/projects";
import { readGateCookie } from "@/lib/gate";
import { getClientIp } from "@/lib/util";
import { rateLimit, RL_SHEET } from "@/lib/rate-limit";
import {
  updateRow,
  removeRow,
  SheetsError,
  type SheetRow,
} from "@/lib/sheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH  /p/<slug>/sheet/rows/<id> — update fields by id
// DELETE /p/<slug>/sheet/rows/<id> — delete by id

type Params = { params: Promise<{ slug: string; id: string }> };

async function loadAndAuth(req: NextRequest, slug: string) {
  const project = await projectBySlugPublic(slug);
  if (!project) return { kind: "not_found" as const };
  if (project.expiresAt && project.expiresAt.getTime() <= Date.now()) {
    return { kind: "gone" as const };
  }
  const sheet = await getProjectSheet(project.id);
  if (!sheet) return { kind: "not_found" as const };
  if (project.isProtected) {
    const ok = await readGateCookie(project.id);
    if (!ok) return { kind: "unauthorized" as const };
  }
  return { kind: "ok" as const, sheet, projectId: project.id };
}

function statusResponse(kind: "not_found" | "gone" | "unauthorized") {
  const map = { not_found: 404, gone: 410, unauthorized: 401 };
  return NextResponse.json({ error: { code: kind } }, { status: map[kind] });
}
function tooMany(retryAfterSec: number): NextResponse {
  return NextResponse.json(
    { error: { code: "rate_limited", retryAfterSec } },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
  );
}

// Sanitised error response — logs raw upstream detail server-side, returns
// a generic code so we don't leak the service account email / GCP
// internals / OAuth failure body to anonymous prototype viewers.
function sheetError(slug: string, err: unknown): NextResponse {
  if (err instanceof SheetsError) {
    console.error(`[sheet ${slug}] sheets api error ${err.status}: ${err.detail}`);
    if (err.status === 403 || err.status === 404) {
      return NextResponse.json(
        { error: { code: "sheet_unreachable" } },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: { code: "sheets_api" } },
      { status: 502 },
    );
  }
  console.error(`[sheet ${slug}] unexpected:`, err);
  return NextResponse.json(
    { error: { code: "internal_error" } },
    { status: 500 },
  );
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { slug, id } = await params;
  const auth = await loadAndAuth(req, slug);
  if (auth.kind !== "ok") return statusResponse(auth.kind);

  const rl = rateLimit(`sheet:w:${auth.projectId}:${getClientIp(req)}`, RL_SHEET);
  if (!rl.allowed) return tooMany(rl.retryAfterSec);

  let body: SheetRow;
  try {
    const text = await req.text();
    body = text ? (JSON.parse(text) as SheetRow) : {};
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_json" } },
      { status: 400 },
    );
  }

  try {
    const updated = await updateRow(
      { sheetId: auth.sheet.sheetId, tabName: auth.sheet.tabName },
      id,
      body,
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
    return sheetError(slug, err);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { slug, id } = await params;
  const auth = await loadAndAuth(req, slug);
  if (auth.kind !== "ok") return statusResponse(auth.kind);

  const rl = rateLimit(`sheet:w:${auth.projectId}:${getClientIp(req)}`, RL_SHEET);
  if (!rl.allowed) return tooMany(rl.retryAfterSec);

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
    return sheetError(slug, err);
  }
}
