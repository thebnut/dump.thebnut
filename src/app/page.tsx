import { redirect } from "next/navigation";
import Link from "next/link";
import { auth, signOut } from "@/lib/auth";
import {
  projectsForOwner,
  type ProjectWithStats,
} from "@/lib/queries";
import { ProjectRow } from "@/components/ProjectRow";
import { Logo } from "@/components/Logo";
import { TermRule, Cursor } from "@/components/TermRule";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const projects = await projectsForOwner(session.user.id);
  const totalHits = projects.reduce((s, p) => s + p.accessCount, 0);

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <main className="mx-auto w-full max-w-5xl p-6 space-y-8 font-mono">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Logo size="lg" href="/" />
          <p className="text-xs text-neutral-500 mt-3">
            <span className="text-[#39ff88]">●</span> signed in as{" "}
            <span className="text-neutral-300">{session.user.email}</span>
            {session.user.role === "admin" ? (
              <span className="ml-2 rounded bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-100">
                admin
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex gap-2 items-center shrink-0">
          {session.user.role === "admin" ? (
            <Link
              href="/admin"
              className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800 whitespace-nowrap"
            >
              [admin]
            </Link>
          ) : null}
          <form action={logout}>
            <button
              type="submit"
              className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800 whitespace-nowrap"
            >
              [sign out]
            </button>
          </form>
          <Link
            href="/projects/new"
            className="rounded-lg border border-[#39ff88] bg-[#39ff88] text-neutral-950 px-3.5 py-1.5 text-sm font-semibold hover:bg-[#5fff9f] whitespace-nowrap"
            style={{ boxShadow: "0 0 16px -4px rgba(57,255,136,0.55)" }}
          >
            ＋ new project
          </Link>
        </div>
      </header>

      <div className="space-y-3">
        <TermRule label={`projects · ${projects.length} · ${totalHits} hits`} />

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 overflow-hidden">
          {projects.length === 0 ? (
            <EmptyState />
          ) : (
            <ul>
              {projects.map((p: ProjectWithStats, i) => (
                <li
                  key={p.id}
                  className={
                    i === 0 ? "" : "border-t border-dashed border-neutral-800"
                  }
                >
                  <ProjectRow project={p} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="flex items-center justify-between text-[11px] text-neutral-600 px-1">
          <span>
            brett@dump:~$<Cursor />
          </span>
          <span>session · 24h</span>
        </div>
      </div>
    </main>
  );
}

function EmptyState() {
  return (
    <div className="p-10 flex flex-col items-center gap-3 text-neutral-400">
      <p className="text-sm">
        <span className="text-neutral-600">// </span>nothing in your dump yet.
      </p>
      <Link
        href="/projects/new"
        className="rounded-lg border border-[#39ff88] bg-[#39ff88] text-neutral-950 px-3.5 py-1.5 text-sm font-semibold hover:bg-[#5fff9f]"
        style={{ boxShadow: "0 0 16px -4px rgba(57,255,136,0.55)" }}
      >
        [ upload a zip ]
      </Link>
    </div>
  );
}
