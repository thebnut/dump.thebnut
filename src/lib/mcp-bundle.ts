import JSZip from "jszip";
import { z } from "zod";

export const MAX_BUNDLE_BYTES = 2 * 1024 * 1024;
export const bundleFile = z.object({ path: z.string().min(1).max(240), content: z.string().max(3 * 1024 * 1024), encoding: z.enum(["utf8", "base64"]).default("utf8") });
export type BundleFile = z.infer<typeof bundleFile>;

export function validPath(path: string) {
  return !/[\\\x00-\x1f?#%]/.test(path) && path.split("/").every(p => p.length > 0 && !p.startsWith(".") && !["node_modules", "Thumbs.db", "__MACOSX"].includes(p));
}
export function htmlBase(html: string, slug: string, path: string) {
  const directory = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
  const href = `https://content.thebnut.com/p/${slug}/${directory.split('/').map(encodeURIComponent).join('/')}`;
  const bases = html.match(/<base\b[^>]*>/gi) ?? [];
  if (bases.length) {
    // Existing bases need an explicit client-side decision; never silently
    // change URL semantics or insert a second effective base.
    if (bases.length !== 1 || !bases[0].includes(`href="${href}"`)) throw new Error(`Resolve the base element in ${path}; expected ${href}`);
    return html;
  }
  if (!/<head\b[^>]*>/i.test(html)) throw new Error(`HTML file ${path} needs an explicit head element`);
  return html.replace(/<head\b[^>]*>/i, match => `${match}\n<base href="${href}">`);
}

export async function prepareMcpBundle(files: BundleFile[], entryPath: string, slug: string): Promise<ArrayBuffer> {
  if (!files.length || files.length > 200 || !validPath(entryPath)) throw new Error("Invalid file bundle");
  const names = new Set<string>(); let total = 0;
  const zip = new JSZip();
  for (const file of files) {
    if (!validPath(file.path) || names.has(file.path)) throw new Error(`Unsafe or duplicate path: ${file.path}`);
    names.add(file.path);
    if (file.encoding === "base64" && (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.content))) throw new Error("Invalid base64 data");
    let bytes = Buffer.from(file.content, file.encoding === "base64" ? "base64" : "utf8");
    total += bytes.byteLength;
    if (total > MAX_BUNDLE_BYTES) throw new Error("Bundle exceeds 2 MiB; optimise assets or use the full API client");
    if (/\.html?$/i.test(file.path)) bytes = Buffer.from(htmlBase(bytes.toString("utf8"), slug, file.path));
    // One intentional wrapping directory prevents the existing upload parser
    // from stripping a meaningful common directory such as pages/.
    zip.file(`upload/${file.path}`, bytes);
  }
  if (!names.has(entryPath) || !/\.html?$/i.test(entryPath)) throw new Error("Entry must identify an included HTML file");
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}

export function requireOwned<T extends { ownerId: string }>(project: T | undefined, userId: string): T {
  if (!project || project.ownerId !== userId) throw new Error("Owned project not found");
  return project;
}
