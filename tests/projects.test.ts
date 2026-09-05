import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import JSZip from "jszip";
import * as schema from "../src/lib/db/schema";

const state = vi.hoisted(() => ({ db: null as unknown, blobs: new Map<string, Uint8Array>(), failPath: "", beforePut: null as null | (() => Promise<void>), deleted: [] as string[] }));
vi.mock("../src/lib/db", () => ({ get db() { return state.db; } }));
vi.mock("@vercel/blob", () => ({
  put: async (path: string, bytes: Uint8Array) => {
    if (state.beforePut) { const callback = state.beforePut; state.beforePut = null; await callback(); }
    if (state.failPath && path.endsWith(state.failPath)) throw new Error("Synthetic storage failure");
    const url = `https://test.public.blob.vercel-storage.com/${path}`;
    state.blobs.set(url, bytes); return { url };
  },
  del: async (urls: string | string[]) => { for (const url of [urls].flat()) { state.deleted.push(url); state.blobs.delete(url); } },
  list: async ({ prefix }: { prefix: string }) => ({ blobs: [...state.blobs.keys()].filter(url => new URL(url).pathname.slice(1).startsWith(prefix)).map(url => ({ url })), cursor: undefined }),
}));
import { createProject, replaceProjectFiles } from "../src/lib/projects";
import { oauthStore } from "../src/lib/oauth-db";
import { POST as mcpPost } from "../src/app/mcp/route";
import { RESOURCE, hashSecret } from "../src/lib/oauth-policy";

const pg = new PGlite();
const db = drizzle(pg, { schema });
const owner = "11111111-1111-4111-8111-111111111111";
async function bundle(files: Record<string, string>) { const zip = new JSZip(); for (const [name, text] of Object.entries(files)) zip.file(name, text); return zip.generateAsync({ type: "arraybuffer" }); }
async function fixture() {
  return createProject({ ownerId: owner, title: "Test page", slug: "portable-fixture", originalFilename: "index.html", zipBuffer: new TextEncoder().encode("<head></head><body>old</body>").buffer as ArrayBuffer, passwords: [{ label: "test", password: "synthetic-password" }], expiresAt: new Date(Date.now() + 86400000) });
}
beforeAll(async () => {
  state.db = db;
  for (const name of readdirSync("drizzle").filter(n => n.endsWith(".sql")).sort()) await pg.exec(readFileSync(`drizzle/${name}`, "utf8"));
}, 20000);
beforeEach(async () => {
  await pg.exec("TRUNCATE users CASCADE");
  await db.insert(schema.users).values({ id: owner, email: "fixture@example.test", passwordHash: "fixture-only" });
  state.blobs.clear(); state.deleted = []; state.failPath = ""; state.beforePut = null;
});
afterAll(async () => { await pg.close(); });

describe("project replacement using a real SQL engine and simulated Blob", () => {
  it("preserves protection, expiry, title and slug during a complete replacement", async () => {
    const original = await fixture(); const oldUrls = [...state.blobs.keys()];
    const updated = await replaceProjectFiles(original.id, await bundle({ "new.html": "<head></head>new", "asset.txt": "asset" }), "new.html", "upload.zip", original.updatedAt.toISOString());
    expect(updated.slug).toBe(original.slug); expect(updated.title).toBe(original.title);
    expect(updated.expiresAt).toEqual(original.expiresAt); expect(updated.isProtected).toBe(true);
    expect(updated.entryPath).toBe("new.html"); expect(updated.blobPrefix).not.toBe(original.blobPrefix);
    expect((await db.select().from(schema.projectPasswords))).toHaveLength(1);
    expect((await db.select().from(schema.projectFiles)).map(f => f.path).sort()).toEqual(["asset.txt", "new.html"]);
    expect(oldUrls.every(url => state.deleted.includes(url))).toBe(true);
    expect(state.blobs.size).toBe(2);
  });
  it("keeps old files live and cleans staged files when storage fails", async () => {
    const original = await fixture(); const oldUrls = [...state.blobs.keys()]; state.failPath = "fail.txt";
    await expect(replaceProjectFiles(original.id, await bundle({ "index.html": "new", "fail.txt": "fail" }), "index.html", "upload.zip")).rejects.toThrow();
    expect([...state.blobs.keys()]).toEqual(oldUrls);
    expect((await db.select().from(schema.projectFiles))[0].blobUrl).toBe(oldUrls[0]);
    expect((await db.select().from(schema.projects))[0].blobPrefix).toBe(original.blobPrefix);
  });
  it("rejects stale writes before uploading", async () => {
    const original = await fixture(); const oldUrls = [...state.blobs.keys()];
    await expect(replaceProjectFiles(original.id, await bundle({ "index.html": "new" }), "index.html", "upload.zip", new Date(0).toISOString())).rejects.toThrow("Project changed");
    expect([...state.blobs.keys()]).toEqual(oldUrls);
  });
  it("requires the originally authenticated owner at replacement time", async () => {
    const original = await fixture();
    await expect(replaceProjectFiles(original.id, await bundle({ "index.html": "new" }), "index.html", "upload.zip", original.updatedAt.toISOString(), "another-owner")).rejects.toThrow("Owned project not found");
  });
  it("rejects ownership changes during the upload even without a timestamp change", async () => {
    const original = await fixture(); const oldUrls = [...state.blobs.keys()];
    const other = "22222222-2222-4222-8222-222222222222";
    await db.insert(schema.users).values({ id: other, email: "other@example.test", passwordHash: "synthetic" });
    state.beforePut = async () => { await db.update(schema.projects).set({ ownerId: other }).where(eq(schema.projects.id, original.id)); };
    await expect(replaceProjectFiles(original.id, await bundle({ "index.html": "new" }), "index.html", "upload.zip", original.updatedAt.toISOString(), owner)).rejects.toThrow("Project changed");
    expect([...state.blobs.keys()]).toEqual(oldUrls);
  });
  it("rejects a concurrent metadata change and cleans the new revision", async () => {
    const original = await fixture(); const oldUrls = [...state.blobs.keys()];
    state.beforePut = async () => { await db.update(schema.projects).set({ title: "Concurrent title", updatedAt: new Date(Date.now() + 1000) }).where(eq(schema.projects.id, original.id)); };
    await expect(replaceProjectFiles(original.id, await bundle({ "index.html": "new" }), "index.html", "upload.zip")).rejects.toThrow("Project changed");
    expect([...state.blobs.keys()]).toEqual(oldUrls);
    expect((await db.select().from(schema.projects))[0].title).toBe("Concurrent title");
  });
  it("a failed create does not reserve the slug or leave partial files", async () => {
    state.failPath = "fail.txt";
    await expect(createProject({ ownerId: owner, title: "Failure", slug: "failure", zipBuffer: await bundle({ "index.html": "html", "fail.txt": "fail" }), originalFilename: "upload.zip", collisionMode: "reject" })).rejects.toThrow();
    expect(await db.select().from(schema.projects)).toHaveLength(0); expect(state.blobs.size).toBe(0);
  });
  it("does not touch a similarly prefixed sibling project", async () => {
    const original = await fixture();
    await createProject({ ownerId: owner, title: "Sibling", slug: "portable-fixture-more", originalFilename: "index.html", zipBuffer: new TextEncoder().encode("sibling").buffer as ArrayBuffer });
    const sibling = [...state.blobs.keys()].find(url => url.includes("portable-fixture-more"))!;
    await replaceProjectFiles(original.id, await bundle({ "index.html": "new" }), "index.html", "upload.zip");
    expect(state.blobs.has(sibling)).toBe(true);
  });
});
describe("OAuth SQL storage", () => {
  it("atomically consumes an authorization code once", async () => {
    await oauthStore.saveCode({ hash: "test-code", userId: owner, challenge: "challenge", scope: ["projects:read"], resource: "test-resource", expiresAt: new Date(Date.now() + 60000) });
    const results = await Promise.all([oauthStore.consumeCode("test-code"), oauthStore.consumeCode("test-code")]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
  it("revokes an entire token pair once and rejects unknown user IDs", async () => {
    const token = { hash: "test-access", refreshHash: "test-refresh", userId: owner, scope: ["projects:read"], resource: "test-resource", accessExpiresAt: new Date(Date.now() + 60000), refreshExpiresAt: new Date(Date.now() + 120000) };
    await oauthStore.saveToken(token);
    expect(await oauthStore.getToken(token.hash, false)).toBeDefined();
    expect(await oauthStore.revokeToken(token.refreshHash, true)).toBe(true);
    expect(await oauthStore.revokeToken(token.refreshHash, true)).toBe(false);
    expect(await oauthStore.getToken(token.hash, false)).toBeUndefined();
    await expect(oauthStore.saveToken({ ...token, hash: "other", refreshHash: "other-refresh", userId: "22222222-2222-4222-8222-222222222222" })).rejects.toThrow();
  });
});

describe("real MCP transport with scoped SQL tokens", () => {
  async function call(method: string, params: unknown, token?: string) {
    const response = await mcpPost(new Request(RESOURCE, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }));
    const raw = await response.text();
    const data = raw.startsWith("event:") ? raw.split("\n").find(line => line.startsWith("data: "))!.slice(6) : raw;
    return { response, body: JSON.parse(data) };
  }
  async function token(scopes = ["projects:read"]) {
    const secret = "t".repeat(43);
    await oauthStore.saveToken({ hash: hashSecret(secret), refreshHash: "transport-refresh", userId: owner, scope: scopes, resource: RESOURCE, accessExpiresAt: new Date(Date.now() + 60000), refreshExpiresAt: new Date(Date.now() + 120000) });
    return secret;
  }
  it("challenges unauthenticated requests with the pinned metadata URL", async () => {
    const { response } = await call("tools/list", {});
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("https://dump.thebnut.com/.well-known/oauth-protected-resource");
  });
  it("lists the five tools and delivers a complete portable workflow", async () => {
    const auth = await token();
    const listed = await call("tools/list", {}, auth);
    expect(listed.response.status).toBe(200);
    expect(listed.body.result.tools.map((t: { name: string }) => t.name)).toContain("get_workflow");
    const result = await call("tools/call", { name: "get_workflow", arguments: { skill: "limitless" } }, auth);
    expect(result.body.result.isError).not.toBe(true);
    expect(result.body.result.content[0].text).toContain("Australia/Brisbane");
  });
  it("does not let a read-only token publish a project", async () => {
    const result = await call("tools/call", { name: "create_project", arguments: { slug: "should-not-exist", title: "Test", entryPath: "index.html", files: [{ path: "index.html", content: "<head></head>", encoding: "utf8" }] } }, await token());
    expect(result.body.result.isError).toBe(true);
    expect(await db.select().from(schema.projects)).toHaveLength(0);
  });
  it("rejects expired and wrong-audience bearer tokens", async () => {
    const auth = await token();
    await db.update(schema.oauthTokens).set({ resource: "https://other.example/mcp" });
    expect((await call("tools/list", {}, auth)).response.status).toBe(401);
    await db.update(schema.oauthTokens).set({ resource: RESOURCE, accessExpiresAt: new Date(0) });
    expect((await call("tools/list", {}, auth)).response.status).toBe(401);
  });
});
