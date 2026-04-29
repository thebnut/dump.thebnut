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

export type CreateProjectInput = {
  ownerId: string;
  title: string;
  slug?: string;
  description?: string | null;
  entryPath?: string;
  zipBuffer: ArrayBuffer;
  passwords?: Array<{ label: string; password: string }>;
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

export async function createProject(input: CreateProjectInput): Promise<Project> {
  const baseSlug = slugify(input.slug || input.title);
  if (!baseSlug) throw new Error("Slug must contain at least one character");
  const slug = await ensureUniqueSlug(baseSlug);
  const blobPrefix = `projects/${slug}`;

  const zip = await JSZip.loadAsync(input.zipBuffer);

  const fileEntries = Object.values(zip.files).filter((f) => !f.dir);
  if (fileEntries.length === 0) throw new Error("Zip contains no files");
  if (fileEntries.length > MAX_FILES)
    throw new Error(`Zip exceeds max file count (${MAX_FILES})`);

  // Strip a single common top-level folder if present (e.g. "reference-mockup/")
  const tops = new Set(
    fileEntries.map((f) => {
      const parts = f.name.split("/");
      return parts.length > 1 ? parts[0] : "";
    }),
  );
  const stripPrefix =
    tops.size === 1 && !tops.has("") ? `${[...tops][0]}/` : "";

  let totalBytes = 0;
  const toUpload: Array<{
    relPath: string;
    bytes: Uint8Array;
    contentType: string;
  }> = [];

  for (const entry of fileEntries) {
    const namePart = stripPrefix
      ? entry.name.slice(stripPrefix.length)
      : entry.name;
    const rel = safeRelative(namePart);
    if (!rel) continue;
    if (rel.startsWith("__MACOSX/") || rel.endsWith(".DS_Store")) continue;
    const bytes = await entry.async("uint8array");
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_TOTAL_BYTES)
      throw new Error(`Zip exceeds max total size (${MAX_TOTAL_BYTES} bytes)`);
    toUpload.push({
      relPath: rel,
      bytes,
      contentType: contentTypeFor(rel),
    });
  }

  if (toUpload.length === 0) throw new Error("No usable files in zip");

  // Determine entry path (default index.html → first .html → first file)
  let entryPath = input.entryPath?.trim();
  if (!entryPath) {
    const hasIndex = toUpload.find((f) => f.relPath === "index.html");
    if (hasIndex) entryPath = "index.html";
    else {
      const firstHtml = toUpload.find((f) =>
        /\.html?$/i.test(f.relPath),
      );
      entryPath = firstHtml?.relPath ?? toUpload[0].relPath;
    }
  } else {
    entryPath = safeRelative(entryPath) || "index.html";
  }

  // Create DB row first so we have a stable id even if blob put fails (we'll cleanup)
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
    // Upload all files to Vercel Blob in parallel
    const uploaded = await Promise.all(
      toUpload.map(async (f) => {
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

    // Add passwords if provided
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
    // Best-effort cleanup
    await deleteProjectArtifacts(project.id, blobPrefix).catch(() => {});
    throw e;
  }
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
  // List & delete all blobs under prefix
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
