import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import {
  projectBySlugPublic,
  passwordsForProjectFull,
} from "@/lib/queries";
import { setGateCookie } from "@/lib/gate";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ to?: string; error?: string }>;
};

export default async function GatePage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const project = await projectBySlugPublic(slug);
  if (!project) redirect("/");

  // If not protected anymore, just go through.
  if (!project.isProtected) {
    redirect(sanitizeRedirect(sp.to, slug));
  }

  async function unlock(formData: FormData) {
    "use server";
    const password = String(formData.get("password") ?? "");
    const to = String(formData.get("to") ?? "");

    const project = await projectBySlugPublic(slug);
    if (!project) redirect("/");

    const passwords = await passwordsForProjectFull(project.id);
    let matched: { id: string } | null = null;
    for (const p of passwords) {
      const ok = await bcrypt.compare(password, p.passwordHash);
      if (ok) {
        matched = { id: p.id };
        break;
      }
    }

    if (!matched) {
      const u = new URLSearchParams();
      if (to) u.set("to", to);
      u.set("error", "1");
      redirect(`/gate/${slug}?${u.toString()}`);
    }

    await setGateCookie(project.id, matched.id);
    redirect(sanitizeRedirect(to, slug));
  }

  return (
    <main className="min-h-dvh grid place-items-center bg-neutral-950 text-neutral-100 p-6">
      <form
        action={unlock}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-neutral-800 bg-neutral-900/50 p-8"
      >
        <div>
          <h1 className="text-lg font-semibold">{project.title}</h1>
          <p className="text-sm text-neutral-400">
            This prototype is password protected.
          </p>
        </div>

        <input type="hidden" name="to" value={sp.to ?? ""} />

        <div className="space-y-2">
          <label className="text-xs uppercase tracking-wide text-neutral-400">
            Password
          </label>
          <input
            name="password"
            type="password"
            required
            autoFocus
            className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-500"
          />
        </div>

        {sp.error ? (
          <p className="text-xs text-red-400">Incorrect password.</p>
        ) : null}

        <button
          type="submit"
          className="w-full rounded-lg bg-white text-neutral-900 px-3 py-2 text-sm font-medium hover:bg-neutral-200 transition"
        >
          Unlock
        </button>
      </form>
    </main>
  );
}

function sanitizeRedirect(to: string | undefined, slug: string): string {
  const fallback = `/p/${slug}/`;
  if (!to) return fallback;
  // Only allow same-origin paths under /p/<slug>/
  if (!to.startsWith(`/p/${slug}/`)) return fallback;
  return to;
}
