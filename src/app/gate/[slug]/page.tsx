import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import {
  projectBySlugPublic,
  passwordsForProjectFull,
} from "@/lib/queries";
import { setGateCookie } from "@/lib/gate";
import { Logo } from "@/components/Logo";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ to?: string; error?: string }>;
};

export default async function GatePage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const project = await projectBySlugPublic(slug);
  if (!project) redirect("/");

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
    <main className="min-h-dvh grid place-items-center bg-neutral-950 text-neutral-100 p-6 font-mono">
      <form
        action={unlock}
        className="w-full max-w-md space-y-4 rounded-xl border border-neutral-800 bg-neutral-900/50 p-7"
      >
        <div className="flex items-center justify-between">
          <Logo size="sm" />
          <span className="text-[11px] text-neutral-500 uppercase tracking-[0.1em]">
            protected
          </span>
        </div>

        <div className="border-t border-dashed border-neutral-800 pt-4">
          <h1 className="text-lg font-semibold tracking-tight">
            {project.title}
          </h1>
          <p className="text-sm text-neutral-400 mt-1.5">
            <span className="text-neutral-600">// </span>
            this prototype needs a password. enter the one you were given.
          </p>
        </div>

        <input type="hidden" name="to" value={sp.to ?? ""} />

        <div className="space-y-1.5">
          <label className="text-xs uppercase tracking-wide text-neutral-500">
            password
          </label>
          <input
            name="password"
            type="password"
            required
            autoFocus
            className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm font-mono focus:outline-none focus:border-[#39ff88] focus:shadow-[0_0_0_1px_#39ff88,0_0_12px_-4px_rgba(57,255,136,0.55)]"
          />
        </div>

        {sp.error ? (
          <p className="text-xs text-red-400">! incorrect password.</p>
        ) : null}

        <button
          type="submit"
          className="w-full rounded-lg border border-[#39ff88] bg-[#39ff88] text-neutral-950 px-3.5 py-2 text-sm font-semibold hover:bg-[#5fff9f] transition shadow-[0_0_16px_-4px_rgba(57,255,136,0.55)] hover:shadow-[0_0_22px_-2px_rgba(57,255,136,0.55)]"
        >
          [ unlock ]
        </button>
      </form>
    </main>
  );
}

function sanitizeRedirect(to: string | undefined, slug: string): string {
  const fallback = `/p/${slug}/`;
  if (!to) return fallback;
  if (!to.startsWith(`/p/${slug}/`)) return fallback;
  return to;
}
