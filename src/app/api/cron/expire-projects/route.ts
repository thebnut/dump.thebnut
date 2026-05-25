import { NextRequest, NextResponse } from "next/server";
import { findExpiredProjects, deleteProject } from "@/lib/projects";
import { getClientIp } from "@/lib/util";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cap per invocation so a sudden flood of expiries can't blow the Vercel
// 10s default route timeout. The cron runs hourly; next run picks up
// anything we didn't reach.
const MAX_PER_RUN = 100;

// Defence-in-depth on top of CRON_SECRET. Legitimate Vercel cron fires
// once per hour, so 6/min is generous; a leaked secret can't be weaponised
// to churn DB+Blob deletes at machine speed.
const RL_CRON = { capacity: 6, refillPerSec: 6 / 60 };

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

  const rl = rateLimit(`cron:${getClientIp(req) ?? "no-ip"}`, RL_CRON);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: { code: "rate_limited", retryAfterSec: rl.retryAfterSec } },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const expired = await findExpiredProjects(MAX_PER_RUN);

  // Run deletes in parallel — each deleteProject() is Blob list+del+DB
  // delete (~200-500ms wall-clock), so a serial loop of 100 would easily
  // blow the 10s Vercel route timeout. `allSettled` keeps the per-row
  // error isolation we want: one Blob 5xx doesn't bail the rest.
  // Concurrency is naturally bounded by the Postgres pool size.
  const settled = await Promise.allSettled(
    expired.map((p) => deleteProject(p.id)),
  );
  const results = settled.map((s, i) => {
    const slug = expired[i].slug;
    if (s.status === "fulfilled") return { slug, ok: true as const };
    const err = s.reason;
    return {
      slug,
      ok: false as const,
      error: err instanceof Error ? err.message : String(err),
    };
  });

  const ok = results.filter((r) => r.ok).length;
  const failed = results.length - ok;
  return NextResponse.json({
    scanned: expired.length,
    deleted: ok,
    failed,
    results,
  });
}
