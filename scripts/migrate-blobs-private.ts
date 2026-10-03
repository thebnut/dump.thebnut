// Copy project files from the public Blob store to the private one and
// repoint their project_files rows. Safe to re-run: rows already on the
// private store are skipped. Public copies are NOT deleted, so until they
// are, protected files are still readable at their old public URLs.
//
// Usage:
//   npx tsx scripts/migrate-blobs-private.ts --dry-run
//   npx tsx scripts/migrate-blobs-private.ts --slug my-proto
//   npx tsx scripts/migrate-blobs-private.ts --protected-only
//   npx tsx scripts/migrate-blobs-private.ts            # everything
//
// Needs BLOB_PRIVATE_READ_WRITE_TOKEN and the database env in .env.local.
// Protected projects are migrated first.
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import crypto from "crypto";
import { put, get, head, BlobNotFoundError } from "@vercel/blob";

const PRIVATE_HOST_SUFFIX = ".private.blob.vercel-storage.com";
// Projects changed more recently than this are skipped (a rerun picks them
// up): their public CDN copy might not reflect the latest upload yet.
const RECENT_UPDATE_MS = 5 * 60 * 1000;

type Args = { dryRun: boolean; slug?: string; protectedOnly: boolean };

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, protectedOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--protected-only") args.protectedOnly = true;
    else if (a === "--slug") {
      const v = argv[++i];
      // A missing value must not silently widen the run to every project.
      if (!v || v.startsWith("--")) throw new Error("--slug needs a value");
      args.slug = v;
    }
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

function sha256(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function isPrivateBlobUrl(url: string): boolean {
  return new URL(url).hostname.endsWith(PRIVATE_HOST_SUFFIX);
}

// Read a blob's bytes. Private reads bypass the CDN (useCache: false).
// Public blobs can't (the API rejects it with a 400); an overwrite purges
// their CDN copy within about a minute, so recently updated projects are
// skipped instead (see RECENT_UPDATE_MS).
async function readBlobBytes(
  url: string,
  access: "public" | "private",
  token: string,
): Promise<Buffer | null> {
  const r = await get(
    url,
    access === "private" ? { access, token, useCache: false } : { access, token },
  );
  if (!r || r.statusCode !== 200) return null;
  return Buffer.from(await new Response(r.stream).arrayBuffer());
}

// The private blob at `pathname`, or null if there is none. Any other
// error (auth, network) propagates rather than reading as "absent".
async function privateHead(pathname: string, token: string) {
  try {
    return await head(pathname, { token });
  } catch (e) {
    if (e instanceof BlobNotFoundError) return null;
    throw e;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = process.env.BLOB_PRIVATE_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_PRIVATE_READ_WRITE_TOKEN is not set");
  const publicToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!publicToken) throw new Error("BLOB_READ_WRITE_TOKEN is not set");

  const { db } = await import("../src/lib/db");
  const { projects, projectFiles } = await import("../src/lib/db/schema");
  const { and, eq, not, like, desc, asc } = await import("drizzle-orm");

  const conditions = [not(like(projectFiles.blobUrl, `%${PRIVATE_HOST_SUFFIX}/%`))];
  if (args.slug) conditions.push(eq(projects.slug, args.slug));
  if (args.protectedOnly) conditions.push(eq(projects.isProtected, true));

  const rows = await db
    .select({
      id: projectFiles.id,
      path: projectFiles.path,
      blobUrl: projectFiles.blobUrl,
      contentType: projectFiles.contentType,
      size: projectFiles.size,
      slug: projects.slug,
      blobPrefix: projects.blobPrefix,
      isProtected: projects.isProtected,
      updatedAt: projects.updatedAt,
    })
    .from(projectFiles)
    .innerJoin(projects, eq(projects.id, projectFiles.projectId))
    .where(and(...conditions))
    .orderBy(desc(projects.isProtected), asc(projects.slug), asc(projectFiles.path));

  const projectCount = new Set(rows.map((r) => r.slug)).size;
  console.log(
    `${rows.length} public file(s) across ${projectCount} project(s)` +
      (args.dryRun ? " [dry run]" : ""),
  );

  let migrated = 0;
  let skipped = 0;
  const failures: string[] = [];

  for (const row of rows) {
    const label = `${row.isProtected ? "[protected] " : ""}${row.slug}/${row.path}`;
    try {
      // The object lives at the URL's pathname; it should equal
      // `${blobPrefix}/${path}`, and a mismatch means something unexpected.
      const pathname = decodeURIComponent(new URL(row.blobUrl).pathname.slice(1));
      if (pathname !== `${row.blobPrefix}/${row.path}`) {
        throw new Error(`pathname mismatch: ${pathname}`);
      }

      if (Date.now() - row.updatedAt.getTime() < RECENT_UPDATE_MS) {
        skipped++;
        console.log(`skipped ${label} (project updated in the last 5 minutes; rerun later)`);
        continue;
      }

      const bytes = await readBlobBytes(row.blobUrl, "public", publicToken);
      if (!bytes) throw new Error("public read failed");
      if (bytes.byteLength !== row.size) {
        throw new Error(`size mismatch: got ${bytes.byteLength}, expected ${row.size}`);
      }

      if (args.dryRun) {
        console.log(`would migrate ${label} (${bytes.byteLength} B)`);
        continue;
      }

      // Never overwrite an existing private object. One already at this
      // pathname is either our own copy from an earlier, interrupted run
      // (identical bytes: adopt it) or a newer re-upload of the project
      // (different bytes: leave it alone, its row already points there).
      let privateUrl: string;
      const meta = await privateHead(pathname, token);
      if (meta) {
        const existing = await readBlobBytes(meta.url, "private", token);
        if (!existing || sha256(existing) !== sha256(bytes)) {
          skipped++;
          console.log(`skipped ${label} (a different private copy already exists)`);
          continue;
        }
        privateUrl = meta.url;
      } else {
        // allowOverwrite: false makes a re-upload that lands between the
        // check above and this put win; we fail and the row keeps its URL.
        const result = await put(pathname, bytes, {
          access: "private",
          contentType: row.contentType,
          addRandomSuffix: false,
          allowOverwrite: false,
          token,
        });
        privateUrl = result.url;
      }
      if (!isPrivateBlobUrl(privateUrl)) {
        throw new Error(`expected a private URL, got ${privateUrl}`);
      }

      // Read it back from origin storage and compare content hashes before
      // repointing the row.
      const copy = await readBlobBytes(privateUrl, "private", token);
      if (!copy) throw new Error("private read-back failed");
      if (sha256(copy) !== sha256(bytes)) throw new Error("private copy hash mismatch");

      // Only repoint if the row still holds the URL we copied; a concurrent
      // re-upload wins, and its own delete cleans up our copy.
      const updated = await db
        .update(projectFiles)
        .set({ blobUrl: privateUrl })
        .where(and(eq(projectFiles.id, row.id), eq(projectFiles.blobUrl, row.blobUrl)))
        .returning({ id: projectFiles.id });
      if (updated.length === 0) {
        skipped++;
        console.log(`skipped ${label} (row changed during migration)`);
        continue;
      }
      migrated++;
      console.log(`migrated ${label}`);
    } catch (e) {
      failures.push(`${label}: ${(e as Error).message}`);
      console.error(`FAILED ${label}: ${(e as Error).message}`);
    }
  }

  console.log(
    `\ndone: ${migrated} migrated, ${skipped} skipped, ${failures.length} failed`,
  );
  if (failures.length > 0) {
    console.log(failures.map((f) => `  - ${f}`).join("\n"));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
