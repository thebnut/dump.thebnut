import type { NextRequest } from "next/server";

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function getClientIp(req: NextRequest | Request): string | null {
  const headers = "headers" in req ? req.headers : null;
  if (!headers) return null;
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() ?? null;
  const real = headers.get("x-real-ip");
  if (real) return real;
  return null;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".pdf": "application/pdf",
};

export function contentTypeFor(path: string): string {
  const lower = path.toLowerCase();
  // Find the longest known extension that matches (handles .woff vs .woff2).
  const dot = lower.lastIndexOf(".");
  if (dot === -1) return "application/octet-stream";
  const ext = lower.slice(dot);
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

// Reject path traversal and absolute paths inside zips.
export function safeRelative(p: string): string | null {
  const normalized = p.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized) return null;
  if (normalized.includes("..")) return null;
  if (normalized.endsWith("/")) return null;
  return normalized;
}
