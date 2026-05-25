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
