import "server-only";
import { put, del, list } from "@vercel/blob";
import JSZip from "jszip";
import bcrypt from "bcryptjs";
import { eq, and } from "drizzle-orm";
import { db } from "./db";
import {
  projects,
  projectFiles,
  projectPasswords,
  type Project,
} from "./db/schema";
import { contentTypeFor, safeRelative, slugify } from "./util";

export class SlugTakenError extends Error {
  constructor(slug: string) {
    super(`Slug already taken: ${slug}`);
    this.name = "SlugTakenError";
  }
}

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipError";
  }
}

export type CreateProjectInput = {
  ownerId: string;
  title: string;
  slug?: string;
  description?: string | null;
  entryPath?: string;
  /** A .zip of static files OR a single .html file. The shape is detected
   *  from the buffer's magic bytes; `originalFilename` is used to validate
   *  single-file uploads. */
  zipBuffer: ArrayBuffer;
  originalFilename?: string;
  passwords?: Array<{ label: string; password: string }>;
  /** auto-suffix: append `-2`, `-3`… on collision (dashboard default).
   *  reject: throw SlugTakenError on collision (API default). */
  collisionMode?: "auto-suffix" | "reject";
};

export type UpdateProjectInput = {
  title?: string;
  description?: string | null;
  entryPath?: string;
  isProtected?: boolean;
};

const MAX_FILES = 200;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

async function ensureUniqueSlug(base: string): Promise<string> {
  let slug = base;
  let n = 1;
  while (true) {
    const existing = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.slug, slug))
      .limit(1);
    if (!existing[0]) return slug;
    n += 1;
    slug = `${base}-${n}`;
  }
}

async function slugIsTaken(slug: string): Promise<boolean> {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  return !!rows[0];
}

type PreparedFile = {
  relPath: string;
  bytes: Uint8Array;
  contentType: string;
};

type PreparedUpload = {
  files: PreparedFile[];
  entryPath: string;
};

// Detect a zip from its magic bytes (PK\x03\x04 / PK\x05\x06 / PK\x07\x08).
// Avoids relying on filename or MIME, both of which lie sometimes.
function isZipBuffer(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 4) return false;
  const v = new Uint8Array(buf, 0, 4);
  return (
    v[0] === 0x50 &&
    v[1] === 0x4b &&
    (v[2] === 0x03 || v[2] === 0x05 || v[2] === 0x07)
  );
}

// Single-file upload (currently HTML only — wrap as a one-file project
// stored at index.html so /p/<slug>/ resolves cleanly).
function prepareSingleFile(
  buffer: ArrayBuffer,
  originalFilename: string | undefined,
): PreparedUpload {
  const filename = (originalFilename ?? "").toLowerCase();
  const isHtml = filename.endsWith(".html") || filename.endsWith(".htm");
  if (!isHtml) {
    throw new ZipError(
      "Single-file uploads must be .html or .htm. For other formats, send a zip.",
    );
  }
  if (buffer.byteLength > MAX_TOTAL_BYTES) {
    throw new ZipError(`File exceeds max size (${MAX_TOTAL_BYTES} bytes)`);
  }
  return {
    files: [
      {
        relPath: "index.html",
        bytes: new Uint8Array(buffer),
        contentType: "text/html; charset=utf-8",
      },
    ],
    entryPath: "index.html",
  };
}

// macOS resource forks, .DS_Store, Windows Thumbs.db — drop on sight.
function isCruft(name: string): boolean {
  return (
    name.startsWith("__MACOSX/") ||
    name.endsWith(".DS_Store") ||
    name.split("/").some((seg) => seg === "Thumbs.db")
  );
}

// If every entry shares one top-level folder (e.g. "reference-mockup/"),
// return that folder so it can be stripped from stored paths.
function detectStripPrefix(entries: JSZip.JSZipObject[]): string {
  const tops = new Set(
    entries.map((f) => {
      const parts = f.name.split("/");
      return parts.length > 1 ? parts[0] : "";
    }),
  );
  return tops.size === 1 && !tops.has("") ? `${[...tops][0]}/` : "";
}

// Walk zip entries, normalise paths, enforce the byte cap.
async function extractZipFiles(
  fileEntries: JSZip.JSZipObject[],
): Promise<PreparedFile[]> {
  const stripPrefix = detectStripPrefix(fileEntries);
  let totalBytes = 0;
  const files: PreparedFile[] = [];
  for (const entry of fileEntries) {
    const namePart = stripPrefix
      ? entry.name.slice(stripPrefix.length)
      : entry.name;
    const rel = safeRelative(namePart);
    if (!rel) continue;
    const bytes = await entry.async("uint8array");
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new ZipError(
        `Zip exceeds max total size (${MAX_TOTAL_BYTES} bytes)`,
      );
    }
    files.push({ relPath: rel, bytes, contentType: contentTypeFor(rel) });
  }
  return files;
}

// Resolve the project's entry file. With a hint, try exact match then
// basename fallback. Without, prefer index.html → first .html → first file.
function resolveEntryPath(
  files: PreparedFile[],
  hint: string | undefined,
): string {
  const trimmed = hint?.trim();
  if (!trimmed) {
    if (files.find((f) => f.relPath === "index.html")) return "index.html";
    const firstHtml = files.find((f) => /\.html?$/i.test(f.relPath));
    return firstHtml?.relPath ?? files[0].relPath;
  }
  const normalized = safeRelative(trimmed);
  if (!normalized) return "index.html";
  if (files.find((f) => f.relPath === normalized)) return normalized;
  const base = normalized.split("/").pop();
  const byBasename = base
    ? files.find((f) => f.relPath.split("/").pop() === base)
    : null;
  return byBasename?.relPath ?? normalized;
}

// Parse + validate the upload (zip or single html), strip macOS cruft and
// any single wrapping folder, resolve the entry path. Pure transformation.
async function prepareUpload(
  buffer: ArrayBuffer,
  entryHint: string | undefined,
  originalFilename?: string,
): Promise<PreparedUpload> {
  if (!isZipBuffer(buffer)) {
    return prepareSingleFile(buffer, originalFilename);
  }
  const zip = await JSZip.loadAsync(buffer);
  const fileEntries = Object.values(zip.files).filter(
    (f) => !f.dir && !isCruft(f.name),
  );
  if (fileEntries.length === 0) throw new ZipError("Zip contains no files");
  if (fileEntries.length > MAX_FILES) {
    throw new ZipError(`Zip exceeds max file count (${MAX_FILES})`);
  }

  const files = await extractZipFiles(fileEntries);
  if (files.length === 0) throw new ZipError("No usable files in zip");

  return { files, entryPath: resolveEntryPath(files, entryHint) };
}

async function uploadFilesToBlob(
  blobPrefix: string,
  prepared: PreparedFile[],
) {
  return Promise.all(
    prepared.map(async (f) => {
      const result = await put(
        `${blobPrefix}/${f.relPath}`,
        Buffer.from(f.bytes),
        {
          access: "public",
          contentType: f.contentType,
          addRandomSuffix: false,
          allowOverwrite: true,
        },
      );
      return { ...f, url: result.url };
    }),
  );
}

export async function createProject(input: CreateProjectInput): Promise<Project> {
  const baseSlug = slugify(input.slug || input.title);
  if (!baseSlug) throw new Error("Slug must contain at least one character");

  const collisionMode = input.collisionMode ?? "auto-suffix";
  let slug: string;
  if (collisionMode === "auto-suffix") {
    slug = await ensureUniqueSlug(baseSlug);
  } else {
    if (await slugIsTaken(baseSlug)) throw new SlugTakenError(baseSlug);
    slug = baseSlug;
  }

  const blobPrefix = `projects/${slug}`;
  const { files, entryPath } = await prepareUpload(
    input.zipBuffer,
    input.entryPath,
    input.originalFilename,
  );

  // Create DB row first so we have a stable id even if Blob put fails.
  const inserted = await db
    .insert(projects)
    .values({
      ownerId: input.ownerId,
      slug,
      title: input.title,
      description: input.description ?? null,
      entryPath,
      isProtected: !!(input.passwords && input.passwords.length > 0),
      blobPrefix,
    })
    .returning();
  const project = inserted[0];

  try {
    const uploaded = await uploadFilesToBlob(blobPrefix, files);
    if (uploaded.length > 0) {
      await db.insert(projectFiles).values(
        uploaded.map((u) => ({
          projectId: project.id,
          path: u.relPath,
          blobUrl: u.url,
          contentType: u.contentType,
          size: u.bytes.byteLength,
        })),
      );
    }

    if (input.passwords && input.passwords.length > 0) {
      const hashed = await Promise.all(
        input.passwords.map(async (p) => ({
          projectId: project.id,
          label: p.label,
          passwordHash: await bcrypt.hash(p.password, 10),
        })),
      );
      await db.insert(projectPasswords).values(hashed);
    }

    return project;
  } catch (e) {
    await deleteProjectArtifacts(project.id, blobPrefix).catch(() => {});
    throw e;
  }
}

// Wipe + replace all files for an existing project. Resolves a new entry
// path if `entryHint` is provided, otherwise keeps the current entry if
// the new zip still contains a file at that path; otherwise re-derives.
export async function replaceProjectFiles(
  projectId: string,
  zipBuffer: ArrayBuffer,
  entryHint?: string,
  originalFilename?: string,
): Promise<Project> {
  const found = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  const project = found[0];
  if (!project) throw new Error("project not found");

  const { files, entryPath } = await prepareUpload(
    zipBuffer,
    entryHint ?? project.entryPath,
    originalFilename,
  );

  // Wipe existing blobs + file rows, but keep the project + passwords + logs.
  await deleteProjectArtifacts(project.id, project.blobPrefix);

  const uploaded = await uploadFilesToBlob(project.blobPrefix, files);
  if (uploaded.length > 0) {
    await db.insert(projectFiles).values(
      uploaded.map((u) => ({
        projectId: project.id,
        path: u.relPath,
        blobUrl: u.url,
        contentType: u.contentType,
        size: u.bytes.byteLength,
      })),
    );
  }

  const updated = await db
    .update(projects)
    .set({ entryPath, updatedAt: new Date() })
    .where(eq(projects.id, project.id))
    .returning();
  return updated[0];
}

export async function deleteProject(projectId: string): Promise<void> {
  const found = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  const project = found[0];
  if (!project) return;
  await deleteProjectArtifacts(projectId, project.blobPrefix);
  await db.delete(projects).where(eq(projects.id, projectId));
}

async function deleteProjectArtifacts(projectId: string, blobPrefix: string) {
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: blobPrefix, cursor });
    if (page.blobs.length > 0) {
      await del(page.blobs.map((b) => b.url));
    }
    cursor = page.cursor;
  } while (cursor);
  await db.delete(projectFiles).where(eq(projectFiles.projectId, projectId));
}

export async function updateProject(
  projectId: string,
  input: UpdateProjectInput,
): Promise<void> {
  const patch: Partial<Project> = { updatedAt: new Date() };
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined)
    patch.description = input.description ?? null;
  if (input.entryPath !== undefined)
    patch.entryPath = safeRelative(input.entryPath) || "index.html";
  if (input.isProtected !== undefined) patch.isProtected = input.isProtected;
  await db.update(projects).set(patch).where(eq(projects.id, projectId));
}

export async function addProjectPassword(
  projectId: string,
  label: string,
  password: string,
): Promise<void> {
  const hash = await bcrypt.hash(password, 10);
  await db
    .insert(projectPasswords)
    .values({ projectId, label, passwordHash: hash });
  await db
    .update(projects)
    .set({ isProtected: true, updatedAt: new Date() })
    .where(eq(projects.id, projectId));
}

export async function updateProjectPassword(
  projectId: string,
  passwordId: string,
  newPassword: string,
): Promise<void> {
  const hash = await bcrypt.hash(newPassword, 10);
  await db
    .update(projectPasswords)
    .set({ passwordHash: hash })
    .where(
      and(
        eq(projectPasswords.id, passwordId),
        eq(projectPasswords.projectId, projectId),
      ),
    );
  await db
    .update(projects)
    .set({ updatedAt: new Date() })
    .where(eq(projects.id, projectId));
}

export async function removeProjectPassword(
  projectId: string,
  passwordId: string,
): Promise<void> {
  await db
    .delete(projectPasswords)
    .where(
      and(
        eq(projectPasswords.id, passwordId),
        eq(projectPasswords.projectId, projectId),
      ),
    );
  const remaining = await db
    .select()
    .from(projectPasswords)
    .where(eq(projectPasswords.projectId, projectId));
  if (remaining.length === 0) {
    await db
      .update(projects)
      .set({ isProtected: false, updatedAt: new Date() })
      .where(eq(projects.id, projectId));
  }
}
