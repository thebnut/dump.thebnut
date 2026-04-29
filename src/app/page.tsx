import { redirect } from "next/navigation";
import Link from "next/link";
import { auth, signOut } from "@/lib/auth";
import {
  projectsForOwner,
  type ProjectWithStats,
} from "@/lib/queries";
import { ProjectRow } from "@/components/ProjectRow";
import { Logo } from "@/components/Logo";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const projects = await projectsForOwner(session.user.id);

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <main className="mx-auto w-full max-w-4xl p-6 space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Logo size="lg" href="/" />
          <p className="text-sm text-neutral-400 mt-2">
            Signed in as {session.user.email}
            {session.user.role === "admin" ? (
              <span className="ml-2 rounded-md bg-neutral-800 px-2 py-0.5 text-xs">
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
              Admin
            </Link>
          ) : null}
          <Link
            href="/projects/new"
            className="rounded-lg bg-white text-neutral-900 px-3 py-1.5 text-sm font-medium hover:bg-neutral-200 whitespace-nowrap"
          >
            New project
          </Link>
          <form action={logout}>
            <button
              type="submit"
              className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800 whitespace-nowrap"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40">
        {projects.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="divide-y divide-neutral-800">
            {projects.map((p: ProjectWithStats) => (
              <ProjectRow key={p.id} project={p} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function EmptyState() {
  return (
    <div className="p-10 flex flex-col items-center gap-3 text-neutral-400">
      <p className="text-sm">Nothing in your dump yet.</p>
      <Link
        href="/projects/new"
        className="rounded-lg bg-white text-neutral-900 px-3 py-1.5 text-sm font-medium hover:bg-neutral-200"
      >
        Upload a zip
      </Link>
    </div>
  );
}
