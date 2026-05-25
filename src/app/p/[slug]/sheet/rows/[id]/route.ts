import { NextRequest, NextResponse } from "next/server";
import { projectBySlugPublic } from "@/lib/queries";
import { getProjectSheet } from "@/lib/projects";
import { readGateCookie } from "@/lib/gate";
import {
  updateRow,
  removeRow,
  SheetsError,
  type SheetRow,
} from "@/lib/sheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH  /p/<slug>/_sheet/rows/<id> — update fields by id
// DELETE /p/<slug>/_sheet/rows/<id> — delete by id

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
  return { kind: "ok" as const, sheet };
}

function statusResponse(kind: "not_found" | "gone" | "unauthorized") {
  const map = { not_found: 404, gone: 410, unauthorized: 401 };
  return NextResponse.json({ error: { code: kind } }, { status: map[kind] });
}

function sheetError(err: unknown): NextResponse {
  if (err instanceof SheetsError) {
    return NextResponse.json(
      { error: { code: "sheets_api", status: err.status, detail: err.detail } },
      { status: err.status === 403 || err.status === 404 ? 502 : 500 },
    );
  }
  return NextResponse.json(
    { error: { code: "internal_error", message: String(err) } },
    { status: 500 },
  );
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { slug, id } = await params;
  const auth = await loadAndAuth(req, slug);
  if (auth.kind !== "ok") return statusResponse(auth.kind);

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
    return sheetError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { slug, id } = await params;
  const auth = await loadAndAuth(req, slug);
  if (auth.kind !== "ok") return statusResponse(auth.kind);

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
    return sheetError(err);
  }
}
