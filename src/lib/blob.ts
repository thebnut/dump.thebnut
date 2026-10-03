import "server-only";
import { put, del, list, get } from "@vercel/blob";

// Two Blob stores during the private-storage migration:
//
// - public  (BLOB_READ_WRITE_TOKEN): the original store. Anything in it is
//   readable by anyone who knows the store host + pathname, which bypasses
//   the password gate.
// - private (BLOB_PRIVATE_READ_WRITE_TOKEN): reads need the store token, so
//   files are only reachable through /p/<slug>/, behind the gate.
//
// Each `project_files.blob_url` records which store holds that file (the
// host is `<store>.public.…` or `<store>.private.…`), so reads route per
// file and a project can be served while it's mid-migration.
// BLOB_WRITE_TARGET=private sends new uploads to the private store; unset,
// they go to the public store as before.

const PRIVATE_HOST_SUFFIX = ".private.blob.vercel-storage.com";

function publicToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN;
}

function privateToken(): string {
  const t = process.env.BLOB_PRIVATE_READ_WRITE_TOKEN;
  if (!t) throw new Error("BLOB_PRIVATE_READ_WRITE_TOKEN is not set");
  return t;
}

export function isPrivateBlobUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(PRIVATE_HOST_SUFFIX);
  } catch {
    return false;
  }
}

function writeTarget(): "public" | "private" {
  return process.env.BLOB_WRITE_TARGET === "private" ? "private" : "public";
}

/** Store one project file in the current write target; returns its URL. */
export async function putProjectFile(
  pathname: string,
  body: Buffer,
  contentType: string,
  target: "public" | "private" = writeTarget(),
): Promise<string> {
  const result = await put(pathname, body, {
    access: target,
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
    token: target === "private" ? privateToken() : publicToken(),
  });
  return result.url;
}

/** Stream a stored file from whichever store its URL points at. */
export async function readBlob(
  url: string,
): Promise<ReadableStream<Uint8Array> | null> {
  if (isPrivateBlobUrl(url)) {
    // useCache: false reads from origin storage. Re-uploads overwrite the
    // same pathname, and a CDN-cached copy would serve the old version.
    const result = await get(url, {
      access: "private",
      token: privateToken(),
      useCache: false,
    });
    if (!result || result.statusCode !== 200) return null;
    return result.stream;
  }
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok || !res.body) return null;
  return res.body;
}

/**
 * Delete every blob under `prefix` in both stores.
 *
 * Callers must pass a prefix ending in "/". Blob `list({ prefix })` is a
 * literal string-prefix match, so "projects/janice-70th" would also match a
 * sibling project's "projects/janice-70th-rsvps/…" files.
 *
 * Both stores are listed before anything is deleted, so a missing token or
 * an unreachable store throws without having removed anything. Callers
 * delete their database rows only after this returns.
 */
export async function deleteBlobsUnderPrefix(prefix: string): Promise<void> {
  if (!prefix.endsWith("/")) {
    throw new Error(`blob prefix must end with "/": ${prefix}`);
  }
  const pub = publicToken();
  if (!pub) throw new Error("BLOB_READ_WRITE_TOKEN is not set");
  const stores = [pub, privateToken()];

  const targets: { token: string; urls: string[] }[] = [];
  for (const token of stores) {
    const urls: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor, token });
      urls.push(...page.blobs.map((b) => b.url));
      cursor = page.cursor;
    } while (cursor);
    targets.push({ token, urls });
  }

  for (const { token, urls } of targets) {
    for (let i = 0; i < urls.length; i += 500) {
      await del(urls.slice(i, i + 500), { token });
    }
  }
}
