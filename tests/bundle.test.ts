import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { htmlBase, prepareMcpBundle, requireOwned, validPath } from "../src/lib/mcp-bundle";
describe("portable static bundles", () => {
  it("preserves nested directories and binary bytes", async () => {
    const buffer = await prepareMcpBundle([{ path: "pages/tool.html", encoding: "utf8", content: "<html><head></head><body><img src='../image.png'></body></html>" }, { path: "image.png", encoding: "base64", content: "AAEC/w==" }], "pages/tool.html", "my-tool");
    const zip = await JSZip.loadAsync(buffer);
    expect(await zip.file("upload/image.png")!.async("base64")).toBe("AAEC/w==");
    expect(await zip.file("upload/pages/tool.html")!.async("string")).toContain('href="https://content.thebnut.com/p/my-tool/pages/"');
  });
  it.each(["../secret", "/index.html", ".env", "foo/.git/config", "foo\\bar", "node_modules/a.js", "x%2fy", "a//b", "a?token=x"])("rejects unsafe path %s", path => { expect(validPath(path)).toBe(false); });
  it("requires the exact entry and rejects duplicate paths", async () => {
    const file = { path: "index.html", encoding: "utf8" as const, content: "<head></head>" };
    await expect(prepareMcpBundle([file], "missing.html", "tool")).rejects.toThrow();
    await expect(prepareMcpBundle([file, file], "index.html", "tool")).rejects.toThrow();
  });
  it("rejects malformed base64 and oversized bundles", async () => {
    await expect(prepareMcpBundle([{ path: "index.html", encoding: "base64", content: "!!!" }], "index.html", "tool")).rejects.toThrow();
    await expect(prepareMcpBundle([{ path: "index.html", encoding: "utf8", content: "x".repeat(2 * 1024 * 1024 + 1) }], "index.html", "tool")).rejects.toThrow();
  });
  it("does not silently replace an existing different base", () => {
    expect(() => htmlBase('<head><base href="/old/"></head>', "tool", "index.html")).toThrow();
    const first = htmlBase("<head></head>", "tool", "index.html");
    expect(htmlBase(first, "tool", "index.html")).toBe(first);
  });
  it("requires ownership even when the user could be an admin", () => {
    expect(() => requireOwned({ ownerId: "other-user" }, "admin-user")).toThrow();
    expect(() => requireOwned(undefined, "owner")).toThrow();
    expect(requireOwned({ ownerId: "owner" }, "owner")).toEqual({ ownerId: "owner" });
  });
});
