import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { AuthInfo, ServerContext } from "@modelcontextprotocol/server";
import { z } from "zod";
import { and, asc, eq, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects, projectFiles } from "@/lib/db/schema";
import { createProject, replaceProjectFiles, SlugTakenError, ZipError } from "@/lib/projects";
import { oauthStore } from "@/lib/oauth-db";
import { CLIENT_ID, ISSUER, RESOURCE, hashSecret } from "@/lib/oauth-policy";
import { bundleFile, prepareMcpBundle, requireOwned } from "@/lib/mcp-bundle";
import { rateLimit, RL_DEFAULT, RL_UPLOAD } from "@/lib/rate-limit";
import { boundedText } from "@/lib/oauth-http";
import workflows from "@/lib/toolkit-workflows.json";

export const runtime = "nodejs";
export const maxDuration = 60;
const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(64);
const content = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
const readAnnotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const writeAnnotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };

function user(ctx: ServerContext, write = false) {
  const auth = ctx.http?.authInfo;
  const id = auth?.extra?.userId;
  if (typeof id !== "string" || !auth?.scopes.includes(write ? "projects:write" : "projects:read")) throw new Error("Required project scope is missing");
  const limit = rateLimit(`mcp:${write ? 'write' : 'read'}:${id}`, write ? RL_UPLOAD : RL_DEFAULT);
  if (!limit.allowed) throw new Error(`Rate limited; retry in ${limit.retryAfterSec} seconds`);
  return id;
}
function serialize(project: typeof projects.$inferSelect) {
  return { slug: project.slug, title: project.title, description: project.description, entryPath: project.entryPath, isProtected: project.isProtected, expiresAt: project.expiresAt, updatedAt: project.updatedAt.toISOString(), url: `${ISSUER}/p/${project.slug}/` };
}
async function owned(slug: string, userId: string) {
  const [project] = await db.select().from(projects).where(and(eq(projects.slug, slug), eq(projects.ownerId, userId))).limit(1);
  return requireOwned(project, userId);
}
async function result(run: () => Promise<unknown>) {
  try { return content(await run()); }
  catch (error) {
    // Do not return DB/Blob errors, signed URLs or token-bearing request data.
    const safe = error instanceof SlugTakenError || error instanceof ZipError || (error instanceof Error && /^(Owned project|Project changed|Required project|Rate limited|Resolve the base|HTML file|Invalid file|Unsafe or duplicate|Invalid base64|Bundle exceeds|Entry must)/.test(error.message));
    return { ...content({ error: safe ? (error as Error).message : "Operation failed. Read the owned project before retrying a write." }), isError: true };
  }
}

const mcp = createMcpHandler(server => {
  server.registerTool("get_workflow", { title: "Load a Brett Toolkit skill", description: "Load the complete portable workflow before research, building a micro-app, editing Outline, summarising Limitless or publishing to dump. Outline and Limitless require their separate native connections.", inputSchema: z.object({ skill: z.enum(["research", "micro-apps", "outline", "limitless", "dump"]) }), annotations: readAnnotations }, async ({ skill }, ctx) => result(async () => { user(ctx); return { skill, version: "0.1.0", instructions: workflows[skill] }; }));
  server.registerTool("list_projects", { title: "List your dump projects", description: "List only projects owned by the connected user. Follow nextCursor until null.", inputSchema: z.object({ cursor: z.string().optional(), limit: z.number().int().min(1).max(100).default(50) }), annotations: readAnnotations }, async ({ cursor, limit }, ctx) => result(async () => {
    const id = user(ctx);
    const rows = await db.select().from(projects).where(and(eq(projects.ownerId, id), cursor ? gt(projects.slug, cursor) : undefined)).orderBy(asc(projects.slug)).limit(limit + 1);
    return { projects: rows.slice(0, limit).map(serialize), nextCursor: rows.length > limit ? rows[limit - 1].slug : null };
  }));
  server.registerTool("get_project", { title: "Read your dump project", description: "Fetch owned project settings, update revision and file list before replacing files. File contents and public gate access are separate.", inputSchema: z.object({ slug: slugSchema }), annotations: readAnnotations }, async ({ slug }, ctx) => result(async () => {
    const p = await owned(slug, user(ctx));
    const files = await db.select({ path: projectFiles.path, contentType: projectFiles.contentType, size: projectFiles.size }).from(projectFiles).where(eq(projectFiles.projectId, p.id)).orderBy(asc(projectFiles.path));
    return { ...serialize(p), files };
  }));
  server.registerTool("create_project", { title: "Publish a new static page", description: "Create a PUBLIC, permanent, owned static project. Never overwrite a slug collision. Supply the complete bundle, at most 200 files / 2 MiB decoded. HTML needs a head element; hosted bases are inserted in a staging copy. No passwords, expiry or server code.", inputSchema: z.object({ slug: slugSchema, title: z.string().min(1).max(200), description: z.string().max(2000).optional(), entryPath: z.string(), files: z.array(bundleFile).min(1).max(200) }), annotations: writeAnnotations }, async ({ slug, title, description, entryPath, files }, ctx) => result(async () => {
    const id = user(ctx, true);
    const zipBuffer = await prepareMcpBundle(files, entryPath, slug);
    const p = await createProject({ ownerId: id, slug, title, description, entryPath, zipBuffer, originalFilename: "upload.zip", collisionMode: "reject" });
    return { ...serialize(p), verification: "Upload complete. Fetch the hosted page and verify its interactions before reporting success." };
  }));
  server.registerTool("replace_project_files", { title: "Replace a static project's files", description: "Replace ALL files of an owned project with the complete supplied bundle. Require updatedAt from a fresh get_project. Keep slug, password protection and expiry; stage uploads before the atomic swap. Omitted files are removed. Read back after uncertain results.", inputSchema: z.object({ slug: slugSchema, expectedUpdatedAt: z.iso.datetime(), entryPath: z.string(), files: z.array(bundleFile).min(1).max(200) }), annotations: { ...writeAnnotations, destructiveHint: true } }, async ({ slug, expectedUpdatedAt, entryPath, files }, ctx) => result(async () => {
    const id = user(ctx, true);
    const p = await owned(slug, id);
    const zipBuffer = await prepareMcpBundle(files, entryPath, slug);
    const updated = await replaceProjectFiles(p.id, zipBuffer, entryPath, "upload.zip", expectedUpdatedAt, id);
    return { ...serialize(updated), verification: "Files replaced. Check the normal and cache-busted hosted URLs." };
  }));
}, { serverInfo: { name: "Brett Toolkit", version: "0.1.0" }, instructions: "Load get_workflow for the relevant task. This server supplies five portable workflows and scoped dump.thebnut publishing; Outline and Limitless data use separately authenticated native connections.", maxSubscriptions: 0 });

const authenticated = withMcpAuth(mcp, async (_req, token): Promise<AuthInfo | undefined> => {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
  const row = await oauthStore.getToken(hashSecret(token), false);
  if (!row || !process.env.TOOLKIT_OWNER_ID || row.userId !== process.env.TOOLKIT_OWNER_ID || row.resource !== RESOURCE || row.accessExpiresAt <= new Date()) return undefined;
  return { token, clientId: CLIENT_ID, scopes: row.scope, expiresAt: Math.floor(row.accessExpiresAt.getTime() / 1000), resource: new URL(RESOURCE), extra: { userId: row.userId } };
}, { required: true, resourceUrl: ISSUER, resourceMetadataPath: "/.well-known/oauth-protected-resource" });

export async function POST(req: Request) {
  let body: string;
  try {
    body = await boundedText(req, 3 * 1024 * 1024);
  } catch { return Response.json({ error: "Request exceeds 3 MiB or is malformed" }, { status: 413, headers: { "Cache-Control": "no-store" } }); }
  try {
    const response = await authenticated(new Request(req.url, { method: "POST", headers: req.headers, body }));
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch { return Response.json({ error: "Publisher temporarily unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
export async function GET(req: Request) {
  const response = await authenticated(req);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
