import { redirect } from "next/navigation";
import Link from "next/link";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { allProjectsAdmin, listUsers } from "@/lib/queries";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "admin") redirect("/");

  const sp = await searchParams;
  const [allUsers, allProjects] = await Promise.all([
    listUsers(),
    allProjectsAdmin(),
  ]);

  async function createUser(formData: FormData) {
    "use server";
    const session = await auth();
    if (session?.user?.role !== "admin") redirect("/login");

    const email = String(formData.get("email") ?? "")
      .trim()
      .toLowerCase();
    const password = String(formData.get("password") ?? "");
    const role = String(formData.get("role") ?? "user");
    if (!email || !password) {
      redirect("/admin?error=missing");
    }
    const hash = await bcrypt.hash(password, 10);
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existing[0]) {
      await db
        .update(users)
        .set({
          passwordHash: hash,
          role: role === "admin" ? "admin" : "user",
        })
        .where(eq(users.email, email));
    } else {
      await db.insert(users).values({
        email,
        passwordHash: hash,
        role: role === "admin" ? "admin" : "user",
      });
    }
    redirect("/admin?ok=1");
  }

  return (
    <main className="mx-auto w-full max-w-5xl p-6 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/"
            className="text-sm text-neutral-400 hover:text-neutral-100"
          >
            ← back
          </Link>
          <h1 className="text-2xl font-semibold mt-1">Admin</h1>
        </div>
      </div>

      <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
        <h2 className="text-sm uppercase tracking-wide text-neutral-400">
          Users
        </h2>
        <ul className="divide-y divide-neutral-800 -mx-2">
          {allUsers.map((u) => (
            <li
              key={u.id}
              className="flex items-center justify-between px-2 py-2 text-sm"
            >
              <div>
                {u.email}{" "}
                <span className="ml-2 text-xs text-neutral-500">{u.role}</span>
              </div>
              <span className="text-xs text-neutral-500">
                {u.projectCount} project{u.projectCount === 1 ? "" : "s"}
              </span>
            </li>
          ))}
        </ul>

        <form
          action={createUser}
          className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 pt-2 border-t border-neutral-800"
        >
          <input
            name="email"
            type="email"
            required
            placeholder="email"
            className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
          />
          <input
            name="password"
            type="password"
            required
            placeholder="password"
            className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
          />
          <select
            name="role"
            defaultValue="user"
            className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
          >
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
          <button
            type="submit"
            className="rounded-lg bg-white text-neutral-900 px-3 py-2 text-sm font-medium hover:bg-neutral-200"
          >
            Save
          </button>
        </form>
        {sp.ok ? (
          <p className="text-xs text-emerald-400">Saved.</p>
        ) : sp.error ? (
          <p className="text-xs text-red-400">{sp.error}</p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
        <h2 className="text-sm uppercase tracking-wide text-neutral-400">
          All projects
        </h2>
        {allProjects.length === 0 ? (
          <p className="text-sm text-neutral-500">No projects yet.</p>
        ) : (
          <ul className="divide-y divide-neutral-800 -mx-2">
            {allProjects.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 px-2 py-2"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/projects/${p.slug}`}
                    className="text-sm font-medium hover:underline truncate inline-block max-w-full"
                  >
                    {p.title}
                  </Link>
                  <div className="text-xs text-neutral-500">
                    by {p.ownerEmail} · /p/{p.slug}/
                  </div>
                </div>
                <div className="text-sm tabular-nums">
                  {p.accessCount} hits
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
