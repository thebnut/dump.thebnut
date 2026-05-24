import { NextRequest, NextResponse } from "next/server";
import { findExpiredProjects, deleteProject } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cap per invocation so a sudden flood of expiries can't blow the Vercel
// 10s default route timeout. The cron runs hourly; next run picks up
// anything we didn't reach.
const MAX_PER_RUN = 100;

/**
 * Scheduled job that hard-deletes expired projects (DB row + Blob files).
 *
 * Triggered by Vercel cron (see `vercel.json`). Vercel sets
 * `Authorization: Bearer ${CRON_SECRET}` on the scheduled invocation when
 * the `CRON_SECRET` env var is configured on the project — we verify that
 * header so a public hit can't churn the database or the Blob bill.
 *
 * Lazy 410 in the file route handler protects users from a project
 * continuing to serve between expiry and the next cron run, so this job
 * is purely about reclaiming storage and freeing the slug. Failure to
 * delete a single project (e.g. Blob 5xx) doesn't stop the rest — the
 * leftover row stays past-expiry and will be retried on the next run.
 */
export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: { code: "not_configured", message: "CRON_SECRET env var is not set" } },
      { status: 503 },
    );
  }
  const header = req.headers.get("authorization") ?? "";
  if (header !== `Bearer ${expected}`) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Bad or missing cron token" } },
      { status: 401 },
    );
  }

  const expired = await findExpiredProjects(MAX_PER_RUN);
  const results: Array<{ slug: string; ok: boolean; error?: string }> = [];
  for (const p of expired) {
    try {
      await deleteProject(p.id);
      results.push({ slug: p.slug, ok: true });
    } catch (err) {
      // Don't bail — keep deleting the others. The failed one stays
      // past-expiry and gets retried on the next run.
      results.push({
        slug: p.slug,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const ok = results.filter((r) => r.ok).length;
  const failed = results.length - ok;
  return NextResponse.json({
    scanned: expired.length,
    deleted: ok,
    failed,
    results,
  });
}
