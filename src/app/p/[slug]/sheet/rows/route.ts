import { NextRequest, NextResponse } from "next/server";
import { projectBySlugPublic } from "@/lib/queries";
import { getProjectSheet } from "@/lib/projects";
import { readGateCookie } from "@/lib/gate";
import { getClientIp } from "@/lib/util";
import { rateLimit, RL_SHEET } from "@/lib/rate-limit";
import {
  listRows,
  createRow,
  SheetsError,
  type SheetRow,
} from "@/lib/sheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /p/<slug>/sheet/rows — list
// POST /p/<slug>/sheet/rows — create
//
// Same auth model as the file route: public if the project is, gated
// by the gate cookie if the project is protected. TTL applies (a 410'd
// project's sheet endpoint also 410s — checking expiry up front).
// Rate-limited per-IP-per-project (RL_SHEET = 30/min) so a single bot
// can't drain Sheets API quota on a public project.

type Params = { params: Promise<{ slug: string }> };

async function loadProjectAndSheet(slug: string) {
  const project = await projectBySlugPublic(slug);
  if (!project) return { project: null, sheet: null };
  if (project.expiresAt && project.expiresAt.getTime() <= Date.now()) {
    return { project, sheet: null, expired: true as const };
  }
  const sheet = await getProjectSheet(project.id);
  return { project, sheet };
}

async function gateOk(
  req: NextRequest,
  project: { id: string; isProtected: boolean },
): Promise<boolean> {
  if (!project.isProtected) return true;
  const ok = await readGateCookie(project.id);
  return !!ok;
}

function notFound(): NextResponse {
  return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
}
function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: { code: "unauthorized" } },
    { status: 401 },
  );
}
function gone(): NextResponse {
  return NextResponse.json({ error: { code: "gone" } }, { status: 410 });
}
function tooMany(retryAfterSec: number): NextResponse {
  return NextResponse.json(
    { error: { code: "rate_limited", retryAfterSec } },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
  );
}

/**
 * Sanitise upstream errors before returning to the client. Raw Google
 * Sheets API response bodies + OAuth token-endpoint errors can leak the
 * service account email, GCP project name, JWT failure reasons, etc. —
 * none of which should be visible to anonymous prototype viewers.
 * Logs the detail server-side (visible in Vercel function logs) and
 * returns a generic code to the caller.
 */
function sheetError(slug: string, err: unknown): NextResponse {
  if (err instanceof SheetsError) {
    console.error(`[sheet ${slug}] sheets api error ${err.status}: ${err.detail}`);
    // Upstream auth/visibility problems (403/404) usually mean someone
    // unshared the sheet or the link is stale. The owner needs to know;
    // anonymous viewers don't get details.
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

export async function GET(req: NextRequest, { params }: Params) {
  const { slug } = await params;
  const { project, sheet, expired } = await loadProjectAndSheet(slug);
  if (!project) return notFound();
  if (expired) return gone();
  if (!sheet) return notFound();
  if (!(await gateOk(req, project))) return unauthorized();

  const rl = rateLimit(`sheet:r:${project.id}:${getClientIp(req)}`, RL_SHEET);
  if (!rl.allowed) return tooMany(rl.retryAfterSec);

  try {
    const rows = await listRows({
      sheetId: sheet.sheetId,
      tabName: sheet.tabName,
    });
    return NextResponse.json(rows, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return sheetError(slug, err);
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { slug } = await params;
  const { project, sheet, expired } = await loadProjectAndSheet(slug);
  if (!project) return notFound();
  if (expired) return gone();
  if (!sheet) return notFound();
  if (!(await gateOk(req, project))) return unauthorized();

  const rl = rateLimit(`sheet:w:${project.id}:${getClientIp(req)}`, RL_SHEET);
  if (!rl.allowed) return tooMany(rl.retryAfterSec);

  let body: SheetRow;
  try {
    // Accept both application/json (the new contract) and text/plain
    // (legacy, for any SPA that still POSTs via the Apps Script style).
    const text = await req.text();
    body = text ? (JSON.parse(text) as SheetRow) : {};
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_json" } },
      { status: 400 },
    );
  }

  try {
    const created = await createRow(
      { sheetId: sheet.sheetId, tabName: sheet.tabName },
      body,
    );
    return NextResponse.json(created, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return sheetError(slug, err);
  }
}
