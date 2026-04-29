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
  // Use Content-Type to decide.
  const isHtml = file.contentType.startsWith("text/html");
  if (isHtml) {
    // Resolve label name for nice display.
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

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": file.contentType,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
