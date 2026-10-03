// Check the private-Blob migration against a deployed site.
//
// 1. Every project_files row points at the private store.
// 2. Every private file exists, at the size recorded for it.
// 3. A private URL can't be read without the store token.
// 4. Every project serves through /p/<slug> on the deployment:
//    - expired: 410
//    - open: entry page 200, plus one non-HTML file byte-identical to its blob
//    - protected: no cookie → redirect to /gate/<slug>; with a gate cookie
//      minted from AUTH_SECRET → entry page 200 and the same byte check
//
// Side effects: entry-page loads write access_logs rows. They're sent with a
// per-run marker user agent and deleted again when the run ends, including
// when it fails partway.
//
// Usage: npx tsx scripts/verify-blobs-private.ts [--base https://content.thebnut.com] [--slug-prefix zz-]
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import crypto from "crypto";
import { head, get } from "@vercel/blob";

const PRIVATE_HOST_SUFFIX = ".private.blob.vercel-storage.com";
// Unique per run, so cleanup only removes this run's access-log rows.
const USER_AGENT = `dump-verify-blobs/1 (${crypto.randomUUID()})`;

function isPrivate(url: string): boolean {
  return new URL(url).hostname.endsWith(PRIVATE_HOST_SUFFIX);
}

function sha256(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

// Must match the token format in src/lib/gate.ts (readVerifiedGateCookie).
function gateCookie(projectId: string, passwordId: string, passwordHash: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  const iat = Date.now();
  const sig = crypto
    .createHmac("sha256", secret)
    .update(`${projectId}.${passwordId}.${iat}.${passwordHash}`)
    .digest("hex");
  return `dt_g_${projectId}=${projectId}.${passwordId}.${iat}.${sig}`;
}

function fileUrl(base: string, slug: string, path: string): string {
  return `${base}/p/${slug}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

async function main() {
  const argv = process.argv.slice(2);
  const baseIdx = argv.indexOf("--base");
  const base = (baseIdx >= 0 ? argv[baseIdx + 1] : "https://content.thebnut.com").replace(/\/+$/, "");
  // The run sends minted gate cookies to `base`, so only known hosts.
  const host = new URL(base).hostname;
  if (
    !["content.thebnut.com", "dump.thebnut.com", "localhost"].includes(host) &&
    !host.endsWith(".vercel.app")
  ) {
    throw new Error(`refusing to send gate cookies to ${host}`);
  }
  const prefixIdx = argv.indexOf("--slug-prefix");
  const slugPrefix = prefixIdx >= 0 ? argv[prefixIdx + 1] : "";
  if (prefixIdx >= 0 && (!slugPrefix || slugPrefix.startsWith("--"))) {
    throw new Error("--slug-prefix needs a value");
  }
  const inScope = (slug: string) => slug.startsWith(slugPrefix);
  const token = process.env.BLOB_PRIVATE_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_PRIVATE_READ_WRITE_TOKEN is not set");
  const startedAt = new Date();

  const { db } = await import("../src/lib/db");
  const { projects, projectFiles, projectPasswords, accessLogs } = await import("../src/lib/db/schema");
  const { and, eq, gte, asc } = await import("drizzle-orm");

  const problems: string[] = [];
  try {
    await runChecks();
  } finally {
    const removed = await db
      .delete(accessLogs)
      .where(and(eq(accessLogs.userAgent, USER_AGENT), gte(accessLogs.ts, startedAt)))
      .returning({ id: accessLogs.id });
    console.log(`   removed ${removed.length} access-log row(s) written by this check`);
  }

  // Declared here so the try/finally above can always clean up logs.
  async function runChecks() {
    const files = await db
      .select({
        projectId: projectFiles.projectId,
        url: projectFiles.blobUrl,
        size: projectFiles.size,
        path: projectFiles.path,
        contentType: projectFiles.contentType,
        slug: projects.slug,
      })
      .from(projectFiles)
      .innerJoin(projects, eq(projects.id, projectFiles.projectId))
      .orderBy(asc(projects.slug), asc(projectFiles.path))
      .then((rows) => rows.filter((r) => inScope(r.slug)));

    const publicRows = files.filter((f) => !isPrivate(f.url));
    console.log(`1. rows still on the public store: ${publicRows.length} of ${files.length}`);
    for (const f of publicRows) problems.push(`public row: ${f.slug}/${f.path}`);

    let checked = 0;
    for (const f of files) {
      if (!isPrivate(f.url)) continue;
      try {
        const meta = await head(f.url, { token });
        if (meta.size !== f.size) problems.push(`size mismatch: ${f.slug}/${f.path}`);
      } catch (e) {
        problems.push(`missing private blob: ${f.slug}/${f.path} (${(e as Error).message})`);
      }
      checked++;
    }
    console.log(`2. private blobs checked: ${checked}`);

    const sample = files.find((f) => isPrivate(f.url));
    if (sample) {
      const res = await fetch(sample.url, { cache: "no-store" });
      console.log(`3. unauthenticated read of a private URL: HTTP ${res.status}`);
      if (res.ok) problems.push(`private URL readable without a token: ${sample.url}`);
    }

    const all = (await db.select().from(projects).orderBy(asc(projects.slug))).filter((p) =>
      inScope(p.slug),
    );
    let pagesOk = 0;
    for (const p of all) {
      const fail = (msg: string) => problems.push(`page ${p.slug}: ${msg}`);
      const headers: Record<string, string> = {
        "Sec-Fetch-Dest": "document",
        "User-Agent": USER_AGENT,
      };
      // No trailing slash: Next 308s "/p/<slug>/" to "/p/<slug>" first.
      const entry = `${base}/p/${p.slug}`;

      if (p.expiresAt && p.expiresAt.getTime() <= Date.now()) {
        const res = await fetch(entry, { redirect: "manual", headers });
        if (res.status === 410) pagesOk++;
        else fail(`expired but HTTP ${res.status}`);
        continue;
      }

      if (p.isProtected) {
        const res = await fetch(entry, { redirect: "manual", headers });
        const loc = res.headers.get("location") ?? "";
        if (res.status !== 307 || new URL(loc, base).pathname !== `/gate/${p.slug}`) {
          fail(`no-cookie request gave HTTP ${res.status} ${loc}, expected 307 to the gate`);
          continue;
        }
        const [pw] = await db
          .select()
          .from(projectPasswords)
          .where(eq(projectPasswords.projectId, p.id))
          .orderBy(asc(projectPasswords.createdAt))
          .limit(1);
        if (!pw) {
          fail("protected but has no passwords");
          continue;
        }
        headers.Cookie = gateCookie(p.id, pw.id, pw.passwordHash);
      }

      // Must be a direct 200: following a redirect could land on the gate
      // page (also a 200) if the minted cookie were rejected.
      const res = await fetch(entry, { redirect: "manual", headers });
      const body = await res.text();
      if (res.status !== 200 || body.length === 0) {
        fail(`entry page HTTP ${res.status} ${res.headers.get("location") ?? ""}`);
        continue;
      }

      // Byte-compare one non-HTML file (HTML is rewritten on the way out).
      const asset = files.find(
        (f) => f.projectId === p.id && !f.contentType.startsWith("text/html"),
      );
      if (asset) {
        const served = await fetch(fileUrl(base, p.slug, asset.path), {
          headers: { ...headers, "Sec-Fetch-Dest": "image" },
        });
        const servedBytes = Buffer.from(await served.arrayBuffer());
        const stored = isPrivate(asset.url)
          ? await get(asset.url, { access: "private", token, useCache: false })
          : null;
        const storedBytes = stored?.stream
          ? Buffer.from(await new Response(stored.stream).arrayBuffer())
          : Buffer.from(await (await fetch(asset.url, { cache: "no-store" })).arrayBuffer());
        if (served.status !== 200 || sha256(servedBytes) !== sha256(storedBytes)) {
          fail(`${asset.path}: HTTP ${served.status}, served bytes differ from blob`);
          continue;
        }
      }
      pagesOk++;
    }
    console.log(`4. projects serving as expected: ${pagesOk} of ${all.length}`);
  }

  if (problems.length > 0) {
    console.log(`\n${problems.length} problem(s):\n` + problems.map((p) => `  - ${p}`).join("\n"));
    process.exit(1);
  }
  console.log("\nall checks passed");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
