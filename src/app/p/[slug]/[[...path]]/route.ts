import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { accessLogs } from "@/lib/db/schema";
import {
  projectBySlugPublic,
  findProjectFile,
} from "@/lib/queries";
import {
  readVerifiedGateCookie,
  setGateCookie,
  tryWalletUnlock,
} from "@/lib/gate";
import { getClientIp } from "@/lib/util";
import { contentRedirectTarget } from "@/lib/origins";
import { readBlob } from "@/lib/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; path?: string[] }> },
) {
  const { slug, path } = await params;

  // Legacy share-links land on the app host (dump.thebnut.com/p/...). Bounce
  // them to the content origin BEFORE doing anything else — no DB lookup, no
  // gate cookie read, no log write. The destination handler on the content
  // origin will do all of that.
  const legacy = contentRedirectTarget(
    req.headers.get("host"),
    req.nextUrl.pathname,
    req.nextUrl.search,
  );
  if (legacy) {
    const res = NextResponse.redirect(legacy, 308);
    res.headers.set("Cache-Control", "public, max-age=300");
    return res;
  }

  const project = await projectBySlugPublic(slug);
  if (!project) return new NextResponse("Not found", { status: 404 });

  // Determine the requested file path within the project.
  const requested =
    path && path.length > 0 ? path.join("/") : project.entryPath;

  // TTL check runs BEFORE the gate cookie check — an expired project must
  // 410 even to the owner. The cron job hard-deletes the row + blob files
  // on its next run; until then we just refuse to serve it. Sub-resource
  // requests (CSS/JS/etc.) get a plain-text 410; document/iframe nav gets
  // a small HTML body so the user sees something explanatory.
  if (project.expiresAt && project.expiresAt.getTime() <= Date.now()) {
    const dest = req.headers.get("sec-fetch-dest");
    const isNavigation = !dest || dest === "document" || dest === "iframe";
    if (!isNavigation) {
      return new NextResponse("Gone", {
        status: 410,
        headers: { "Cache-Control": "no-store" },
      });
    }
    return new NextResponse(expiredPageHtml(project.title), {
      status: 410,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  // If protected, check cookie. If absent, redirect navigations to the gate
  // page, but reject sub-resource requests (CSS, JS, images, fonts, fetch)
  // with a 401. We can't 307 a stylesheet request to an HTML gate page —
  // the browser would silently load the HTML body as CSS, leaving the
  // (already-unlocked) parent page rendering with broken styles. Better
  // to fail loudly so the network tab shows the real problem.
  let passwordLabelUsed: string | null = null;
  let passwordLabelIdUsed: string | null = null;
  // `Sec-Fetch-Dest: document` (or `iframe` when embedded) indicates a
  // top-level navigation where redirecting to the gate is the right
  // behaviour. Everything else is a sub-resource fetched by the page
  // itself — `style`, `script`, `image`, `font`, `empty` (fetch()), etc.
  // If the header is absent (older browsers, curl, scripted clients)
  // we treat the request as a navigation and let it through to the gate.
  const dest = req.headers.get("sec-fetch-dest");
  const isNavigation = !dest || dest === "document" || dest === "iframe";
  if (project.isProtected) {
    // readVerifiedGateCookie returns null when the HMAC is bad, the cookie
    // is past its ceiling, or its password has been deleted or rotated. All
    // of those fall through to the wallet, then the gate, below.
    const session = await readVerifiedGateCookie(project.id);
    if (session) {
      passwordLabelIdUsed = session.passwordLabelId;
      passwordLabelUsed = session.label;
      // Sliding window: re-stamp the gate cookie so an actively-used prototype
      // keeps extending its 30-day window instead of expiring mid-use. The
      // original issue time is kept, so the 90-day ceiling still applies.
      // Page loads are enough to keep it fresh; skipping sub-resources
      // avoids a Set-Cookie on every CSS/JS/image response.
      if (isNavigation) {
        await setGateCookie(
          project.id,
          { id: session.passwordLabelId, passwordHash: session.passwordHash },
          session.issuedAt,
        );
      }
    } else {
      // Before prompting, try the visitor's password wallet — if they've
      // already unlocked another of this owner's prototypes with the same
      // password, this one unlocks silently. Only attempted on navigations:
      // the document request sets the gate cookie, so the page's
      // sub-resources then take the cookie fast path above and never reach
      // this bcrypt work.
      const walletMatch = isNavigation
        ? await tryWalletUnlock(project, getClientIp(req) ?? "unknown")
        : null;
      if (walletMatch) {
        await setGateCookie(
          project.id,
          walletMatch.password,
          walletMatch.issuedAt,
        );
        passwordLabelIdUsed = walletMatch.password.id;
        passwordLabelUsed = walletMatch.password.label;
      } else {
        if (!isNavigation) {
          return new NextResponse("Unauthorized", {
            status: 401,
            headers: { "Cache-Control": "no-store" },
          });
        }
        const url = req.nextUrl.clone();
        url.pathname = `/gate/${slug}`;
        url.searchParams.set("to", `/p/${slug}/${requested}`);
        const res = NextResponse.redirect(url);
        // Belt-and-braces: keep edge caches from holding onto this redirect
        // and serving it back to requests that DO have a valid cookie.
        res.headers.set("Cache-Control", "no-store");
        return res;
      }
    }
  }

  const file = await findProjectFile(project.id, requested);
  if (!file) {
    return new NextResponse("File not found in project", { status: 404 });
  }

  // Read from Vercel Blob (public or private store, per the file's URL) and
  // stream back through our origin.
  let upstream: ReadableStream<Uint8Array> | null = null;
  try {
    upstream = await readBlob(file.blobUrl);
  } catch (e) {
    console.error(`[blob ${slug}/${requested}] read failed:`, e);
  }
  if (!upstream) {
    return new NextResponse("Upstream fetch failed", { status: 502 });
  }

  // Log only "page" loads (HTML), not every asset, to keep the log readable.
  // Wrap the insert: a logging failure (e.g. a race where the password got
  // deleted between the gate check and here, tripping the FK constraint)
  // must never block the user from seeing the page they're authorised for.
  const isHtml = file.contentType.startsWith("text/html");
  if (isHtml) {
    try {
      await db.insert(accessLogs).values({
        projectId: project.id,
        ip: getClientIp(req),
        userAgent: req.headers.get("user-agent") ?? null,
        path: requested,
        passwordLabelUsed,
        passwordLabelId: passwordLabelIdUsed,
      });
    } catch (e) {
      console.error(`[access-log ${slug}] insert failed:`, e);
    }
  }

  // For HTML files, two transforms on the way out:
  //   1. rewriteHtmlPaths — leading-slash absolute paths (Vite/CRA
  //      `base: '/'`) get project-scoped.
  //   2. ensureBaseHref — inject <base href="/p/<slug>/"> so RELATIVE
  //      links (e.g. <a href="data/foo.csv">) resolve to the project
  //      regardless of whether the URL has a trailing slash. Next.js
  //      strips the slash via a 308, which would otherwise make
  //      relative paths resolve against /p/ instead of /p/<slug>/.
  //   3. ensureDescriptionMeta — give link-preview crawlers a generic
  //      description when the prototype doesn't declare one, so a shared
  //      URL reads "Shared link" rather than nothing. Protected
  //      prototypes get "Shared secure link" (crawlers normally hit the
  //      gate page for those; see its metadata export).
  if (isHtml) {
    const text = await new Response(upstream).text();
    let rewritten = rewriteHtmlPaths(text, slug);
    rewritten = ensureBaseHref(rewritten, `/p/${slug}/`);
    rewritten = ensureDescriptionMeta(
      rewritten,
      project.isProtected ? "Shared secure link" : "Shared link",
    );
    return new NextResponse(rewritten, {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  return new NextResponse(upstream, {
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

// Inject <meta name="description"> + <meta property="og:description"> into
// <head> when the page declares neither. A prototype that ships its own
// description keeps it — the author knows what they want the preview to
// say. No <head>: leave the document alone, same as ensureBaseHref.
export function ensureDescriptionMeta(html: string, description: string): string {
  // Exact attribute name and value, quoted or not (minified HTML often
  // ships <meta name=description ...> unquoted), ignoring commented-out
  // tags. `data-name=`, `name="description-extra"` and the like don't count.
  const live = html.replace(/<!--[\s\S]*?-->/g, "");
  const declares = (attr: string, value: string) =>
    new RegExp(
      String.raw`<meta\b[^>]*\s${attr}\s*=\s*(["']?)${value}\1(?=[\s/>])`,
      "i",
    ).test(live);
  if (declares("name", "description") || declares("property", "og:description")) {
    return html;
  }
  const safe = escapeHtml(description);
  return html.replace(
    /<head\b[^>]*>/i,
    (m) =>
      `${m}\n<meta name="description" content="${safe}">\n<meta property="og:description" content="${safe}">`,
  );
}

// The 410 Gone page shown when a protected/expired project is hit by a
// top-level navigation. Inlined HTML (not a Next page) because this route
// is purely a streaming file server; pulling in a layout would defeat the
// "go straight to a status response" intent. Keep it tiny and self-contained.
function expiredPageHtml(title: string): string {
  const safeTitle = escapeHtml(title);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>expired — ${safeTitle}</title>
<style>
  html, body { margin: 0; padding: 0; }
  body {
    min-height: 100dvh;
    display: grid; place-items: center;
    background: #0a0a0a; color: #ededed;
    font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  main { max-width: 480px; padding: 32px 24px; text-align: center; }
  h1 { font-size: 18px; margin: 0 0 12px; letter-spacing: -0.01em; }
  p { color: #9a9a9a; margin: 8px 0; }
  .tag {
    display: inline-block;
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em;
    color: #f87171; border: 1px dashed #f87171; padding: 3px 8px;
    border-radius: 4px; margin-bottom: 16px;
  }
  a { color: #39ff88; text-decoration: none; }
  a:hover { text-decoration: underline; }
</style>
</head>
<body>
<main>
  <div class="tag">410 gone</div>
  <h1>this prototype has expired</h1>
  <p>${safeTitle} was set to auto-expire and has been taken offline.</p>
  <p>if you're the owner, head to <a href="/">your dashboard</a> to re-upload or set a new expiry.</p>
</main>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
