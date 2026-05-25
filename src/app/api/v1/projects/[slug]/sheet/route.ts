import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { authenticate, jsonError, jsonOk } from "@/lib/api";
import {
  getProjectSheet,
  setProjectSheet,
  unlinkProjectSheet,
} from "@/lib/projects";
import { parseSheetUrl, probeSheet, SheetsError } from "@/lib/sheets";
import { rateLimit, RL_DEFAULT } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET    /api/v1/projects/<slug>/sheet — return the linked sheet (or 404)
// PUT    /api/v1/projects/<slug>/sheet — link/replace { sheetUrl, tabName? }
// DELETE /api/v1/projects/<slug>/sheet — unlink

type Params = { params: Promise<{ slug: string }> };

async function loadOwned(slug: string, userId: string) {
  const rows = await db
    .select({ id: projects.id, ownerId: projects.ownerId })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  const p = rows[0];
  if (!p) return null;
  if (p.ownerId !== userId) return "forbidden" as const;
  return p;
}

function serviceAccountInfo() {
  return {
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? null,
  };
}

export async function GET(req: NextRequest, { params }: Params) {
  const auth = await authenticate(req);
  if (!("user" in auth)) return auth;
  const rl = rateLimit(`sheet:get:${auth.tokenId}`, RL_DEFAULT);
  if (!rl.allowed)
    return jsonError("rate_limited", `Retry in ${rl.retryAfterSec}s.`);

  const { slug } = await params;
  const project = await loadOwned(slug, auth.user.id);
  if (!project) return jsonError("not_found", `No project with slug '${slug}'.`);
  if (project === "forbidden")
    return jsonError("forbidden", "You do not own this project.");

  const sheet = await getProjectSheet(project.id);
  if (!sheet) {
    return jsonOk({
      sheet: null,
      serviceAccount: serviceAccountInfo(),
    });
  }
  return jsonOk({
    sheet: {
      sheetId: sheet.sheetId,
      tabName: sheet.tabName,
      sheetUrl: `https://docs.google.com/spreadsheets/d/${sheet.sheetId}/edit`,
    },
    serviceAccount: serviceAccountInfo(),
  });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const auth = await authenticate(req);
  if (!("user" in auth)) return auth;
  const rl = rateLimit(`sheet:put:${auth.tokenId}`, RL_DEFAULT);
  if (!rl.allowed)
    return jsonError("rate_limited", `Retry in ${rl.retryAfterSec}s.`);

  const { slug } = await params;
  const project = await loadOwned(slug, auth.user.id);
  if (!project) return jsonError("not_found", `No project with slug '${slug}'.`);
  if (project === "forbidden")
    return jsonError("forbidden", "You do not own this project.");

  let body: { sheetUrl?: string; tabName?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError("missing_field", "Expected JSON body.");
  }
  const sheetUrlRaw = String(body.sheetUrl ?? "").trim();
  const tabName = String(body.tabName ?? "Sheet1").trim() || "Sheet1";
  if (!sheetUrlRaw) {
    return jsonError("missing_field", "sheetUrl is required.");
  }
  const sheetId = parseSheetUrl(sheetUrlRaw);
  if (!sheetId) {
    return jsonError(
      "missing_field",
      "sheetUrl must be a Google Sheets URL or a bare sheet ID.",
    );
  }

  // Verify the sheet is reachable and the tab exists, surfacing a clear
  // error before we commit anything to the DB.
  let probe;
  try {
    probe = await probeSheet(sheetId);
  } catch (e) {
    if (e instanceof SheetsError) {
      const sa = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? "<the service account>";
      if (e.status === 403 || e.status === 404) {
        return NextResponse.json(
          {
            error: {
              code: "sheet_unreachable",
              message: `Sheet not accessible. Share it with ${sa} (Editor access) and try again.`,
            },
          },
          { status: 400 },
        );
      }
      return jsonError("internal_error", `Sheets API: ${e.detail}`);
    }
    throw e;
  }
  if (!probe.tabs.includes(tabName)) {
    return jsonError(
      "missing_field",
      `Tab "${tabName}" not found. Available: ${probe.tabs.join(", ")}.`,
    );
  }

  const saved = await setProjectSheet(project.id, sheetId, tabName);
  return jsonOk({
    sheet: {
      sheetId: saved.sheetId,
      tabName: saved.tabName,
      sheetUrl: `https://docs.google.com/spreadsheets/d/${saved.sheetId}/edit`,
      title: probe.title,
      tabs: probe.tabs,
    },
    serviceAccount: serviceAccountInfo(),
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const auth = await authenticate(req);
  if (!("user" in auth)) return auth;
  const rl = rateLimit(`sheet:del:${auth.tokenId}`, RL_DEFAULT);
  if (!rl.allowed)
    return jsonError("rate_limited", `Retry in ${rl.retryAfterSec}s.`);

  const { slug } = await params;
  const project = await loadOwned(slug, auth.user.id);
  if (!project) return jsonError("not_found", `No project with slug '${slug}'.`);
  if (project === "forbidden")
    return jsonError("forbidden", "You do not own this project.");

  await unlinkProjectSheet(project.id);
  return jsonOk({ unlinked: true });
}
