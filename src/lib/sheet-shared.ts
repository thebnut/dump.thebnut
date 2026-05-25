import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { SheetsError } from "./sheets";

/**
 * Shared helpers used by both `/p/<slug>/sheet/*` and `/api/v1/projects/<slug>/sheet`.
 * Kept in one place so a future tweak (e.g. adding Retry-After to all 429s)
 * only needs to happen once.
 */

// Input shape for linking a sheet — used by both the dashboard server
// action and the API v1 PUT handler. Conservative bounds: a sheet URL
// is well under 2KB, a tab name under 100 chars in practice. Caps any
// pathological/abusive input before it reaches probeSheet.
export const linkSheetSchema = z.object({
  sheetUrl: z.string().trim().min(1).max(2048),
  tabName: z.string().trim().min(1).max(100),
});

/**
 * Cap the size of a POST/PATCH body for `/p/<slug>/sheet/rows*`. A real
 * row typically serialises to a few hundred bytes; this cap exists to
 * stop a hostile anonymous caller (the endpoint is public on unprotected
 * projects) from streaming megabytes through us into the linked sheet.
 *
 * Returns the parsed JSON (or null for empty body), or a 413 / 400
 * response if the body's too big / not valid JSON.
 */
const MAX_SHEET_BODY_BYTES = 64 * 1024; // 64 KB

export async function readSheetBody(
  req: { text(): Promise<string> },
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: NextResponse }> {
  const text = await req.text();
  if (text.length > MAX_SHEET_BODY_BYTES) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: "body_too_large", maxBytes: MAX_SHEET_BODY_BYTES } },
        { status: 413 },
      ),
    };
  }
  if (!text) return { ok: true, body: {} };
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: { code: "invalid_json", message: "Body must be a JSON object." } },
          { status: 400 },
        ),
      };
    }
    return { ok: true, body: parsed as Record<string, unknown> };
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: "invalid_json" } },
        { status: 400 },
      ),
    };
  }
}

/**
 * One rate-limit key per project+IP, regardless of HTTP verb.
 * All four sheet endpoints (GET/POST rows, PATCH/DELETE rows/:id) compete
 * for the same RL_SHEET token bucket — they share the underlying Sheets
 * API quota, so the limit needs to reflect total calls, not per-verb.
 *
 * Falls back to a project-only key when the IP header is absent (local
 * dev, some proxy configs). That collapses all null-IP requests into one
 * bucket, which is fine: dev shouldn't be hammering enough to drain 30
 * tokens, and in prod Vercel always sets x-forwarded-for.
 */
export function sheetRateLimitKey(projectId: string, ip: string | null): string {
  return `sheet:${projectId}:${ip ?? "no-ip"}`;
}

// 429 with Retry-After. Same wire shape used by every sheet-touching route.
export function tooManyResponse(retryAfterSec: number): NextResponse {
  return NextResponse.json(
    { error: { code: "rate_limited", retryAfterSec } },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
  );
}

/**
 * Sanitised upstream-error response. Logs the raw upstream detail
 * server-side (Vercel function logs) for triage and returns only a
 * generic code so we don't leak the service account email, GCP
 * internals, or OAuth failure bodies to anonymous prototype viewers.
 */
export function sheetErrorResponse(slug: string, err: unknown): NextResponse {
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
