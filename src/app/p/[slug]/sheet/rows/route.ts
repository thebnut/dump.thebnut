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
import { listRows, createRow } from "@/lib/sheets";

// Legacy host: bounce to the content origin before any DB / gate / Sheets
// work. 308 preserves method + body, so POST bodies survive the redirect.
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

async function gateOk(project: {
  id: string;
  isProtected: boolean;
}): Promise<boolean> {
  // readVerifiedGateCookie reads from cookies() — doesn't need the request
  // object. It also checks that the cookie's password_label_id still exists,
  // so a rotated/deleted password invalidates the session immediately
  // (rather than leaving the user with sheet write access on a revoked pw).
  if (!project.isProtected) return true;
  const ok = await readVerifiedGateCookie(project.id);
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

export async function GET(req: NextRequest, { params }: Params) {
  const legacy = redirectIfLegacyHost(req);
  if (legacy) return legacy;

  const { slug } = await params;
  const { project, sheet, expired } = await loadProjectAndSheet(slug);
  if (!project) return notFound();
  if (expired) return gone();
  if (!sheet) return notFound();
  if (!(await gateOk(project))) return unauthorized();

  const rl = rateLimit(sheetRateLimitKey(project.id, getClientIp(req)), RL_SHEET);
  if (!rl.allowed) return tooManyResponse(rl.retryAfterSec);

  try {
    const rows = await listRows({
      sheetId: sheet.sheetId,
      tabName: sheet.tabName,
    });
    return NextResponse.json(rows, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return sheetErrorResponse(slug, err);
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const legacy = redirectIfLegacyHost(req);
  if (legacy) return legacy;

  const { slug } = await params;
  const { project, sheet, expired } = await loadProjectAndSheet(slug);
  if (!project) return notFound();
  if (expired) return gone();
  if (!sheet) return notFound();
  if (!(await gateOk(project))) return unauthorized();

  const rl = rateLimit(sheetRateLimitKey(project.id, getClientIp(req)), RL_SHEET);
  if (!rl.allowed) return tooManyResponse(rl.retryAfterSec);

  // readSheetBody caps body at 64 KB so a hostile anonymous caller (the
  // endpoint is public on unprotected projects) can't stream large
  // payloads through us. Also asserts body is a JSON object, not an
  // array or primitive.
  const parsed = await readSheetBody(req);
  if (!parsed.ok) return parsed.response;

  try {
    const created = await createRow(
      { sheetId: sheet.sheetId, tabName: sheet.tabName },
      parsed.body,
    );
    return NextResponse.json(created, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return sheetErrorResponse(slug, err);
  }
}
