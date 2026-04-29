import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { accessLogs } from "@/lib/db/schema";
import {
  projectBySlugPublic,
  findProjectFile,
} from "@/lib/queries";
import { readGateCookie } from "@/lib/gate";
import { getClientIp } from "@/lib/util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; path?: string[] }> },
) {
  const { slug, path } = await params;
  const project = await projectBySlugPublic(slug);
  if (!project) return new NextResponse("Not found", { status: 404 });

  // Determine the requested file path within the project.
  const requested =
    path && path.length > 0 ? path.join("/") : project.entryPath;

  // If protected, check cookie. If absent, redirect to gate.
  let passwordLabelUsed: string | null = null;
  let passwordLabelIdUsed: string | null = null;
  if (project.isProtected) {
    const ok = await readGateCookie(project.id);
    if (!ok) {
      const url = req.nextUrl.clone();
      url.pathname = `/gate/${slug}`;
      url.searchParams.set("to", `/p/${slug}/${requested}`);
      return NextResponse.redirect(url);
    }
    passwordLabelIdUsed = ok.passwordLabelId;
  }

  const file = await findProjectFile(project.id, requested);
  if (!file) {
    return new NextResponse("File not found in project", { status: 404 });
  }

  // Fetch from Vercel Blob and stream back through our origin.
  const upstream = await fetch(file.blobUrl, { cache: "no-store" });
  if (!upstream.ok || !upstream.body) {
    return new NextResponse("Upstream fetch failed", { status: 502 });
  }

  // Log only "page" loads (HTML), not every asset, to keep the log readable.
  const isHtml = file.contentType.startsWith("text/html");
  if (isHtml) {
    if (passwordLabelIdUsed) {
      const { db: _db } = await import("@/lib/db");
      const { projectPasswords } = await import("@/lib/db/schema");
      const { eq } = await import("drizzle-orm");
      const [pw] = await _db
        .select({ label: projectPasswords.label })
        .from(projectPasswords)
        .where(eq(projectPasswords.id, passwordLabelIdUsed))
        .limit(1);
      passwordLabelUsed = pw?.label ?? null;
    }
    await db.insert(accessLogs).values({
      projectId: project.id,
      ip: getClientIp(req),
      userAgent: req.headers.get("user-agent") ?? null,
      path: requested,
      passwordLabelUsed,
      passwordLabelId: passwordLabelIdUsed,
    });
  }

  // For HTML files, two transforms on the way out:
  //   1. rewriteHtmlPaths — leading-slash absolute paths (Vite/CRA
  //      `base: '/'`) get project-scoped.
  //   2. ensureBaseHref — inject <base href="/p/<slug>/"> so RELATIVE
  //      links (e.g. <a href="data/foo.csv">) resolve to the project
  //      regardless of whether the URL has a trailing slash. Next.js
  //      strips the slash via a 308, which would otherwise make
  //      relative paths resolve against /p/ instead of /p/<slug>/.
  if (isHtml) {
    const text = await upstream.text();
    let rewritten = rewriteHtmlPaths(text, slug);
    rewritten = ensureBaseHref(rewritten, `/p/${slug}/`);
    return new NextResponse(rewritten, {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": file.contentType,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

// Rewrite href/src/action="/foo" → "/p/<slug>/foo" so absolute paths
// inside hosted HTML resolve to the project's prefix instead of the
// origin root.
//
// - Skips protocol-relative URLs (//cdn.example.com/...): the `(?!\/)`
//   negative lookahead rejects a second slash.
// - Skips already-prefixed paths (idempotent): the `(?!p\/<slug>\/)`
//   prevents double-prefixing on edge cases.
// - Doesn't touch CSS-in-JS, srcset (rare in mockups), or runtime
//   dynamic imports inside JS bundles. Document the constraint.
export function rewriteHtmlPaths(html: string, slug: string): string {
  const prefix = `/p/${slug}/`;
  // Escape regex metacharacters in the slug. Today slugify() strips
  // everything outside a-z0-9-, but the DB column is unconstrained text
  // so this is defence-in-depth against future paths that bypass it.
  const escapedSlug = slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Negative lookahead also matches /p/<slug> without trailing slash so
  // a second pass over already-rewritten HTML doesn't double-prefix.
  // Handles both double- and single-quoted attribute values.
  const re = new RegExp(
    String.raw`\b(href|src|action|poster|formaction)\s*=\s*(["'])\/(?!\/|p\/${escapedSlug}(?:\/|$))`,
    "gi",
  );
  return html.replace(
    re,
    (_m, attr: string, quote: string) => `${attr}=${quote}${prefix}`,
  );
}

// Inject <base href="..."> into <head> so relative URLs in the page
// resolve against the project's prefix. Skip if the page already has
// a <base> tag (the user knows what they want). If there's no <head>,
// don't touch the document — anything without a head is too weird to
// patch and probably wasn't going to render correctly anyway.
export function ensureBaseHref(html: string, baseHref: string): string {
  if (/<base\b[^>]*\bhref\s*=/i.test(html)) return html;
  return html.replace(
    /<head\b[^>]*>/i,
    (m) => `${m}\n<base href="${baseHref}">`,
  );
}
