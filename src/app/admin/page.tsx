import { redirect } from "next/navigation";
import Link from "next/link";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { allProjectsAdmin, listUsers } from "@/lib/queries";
import { TermRule } from "@/components/TermRule";

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
    <main className="mx-auto w-full max-w-5xl p-6 space-y-6 font-mono">
      <div>
        <Link
          href="/"
          className="text-sm text-neutral-500 hover:text-[#39ff88] transition-colors"
        >
          ← back
        </Link>
        <h1 className="text-2xl font-semibold mt-1">$ admin</h1>
        <p className="text-xs text-neutral-500 mt-1">
          <span className="text-neutral-600">{"// "}</span>users + all projects
          across the dump.
        </p>
      </div>

      <section className="space-y-2">
        <TermRule label={`users · ${allUsers.length}`} />
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
          {allUsers.length === 0 ? (
            <p className="text-sm text-neutral-600">{"// no users yet."}</p>
          ) : (
            <ul className="-mx-2">
              {allUsers.map((u, i) => (
                <li
                  key={u.id}
                  className={`flex items-center justify-between px-2 py-2.5 text-sm ${
                    i === 0 ? "" : "border-t border-dashed border-neutral-800"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={
                        u.role === "admin"
                          ? "text-[#39ff88]"
                          : "text-neutral-600"
                      }
                    >
                      ●
                    </span>
                    <span>{u.email}</span>
                    <span className="rounded bg-neutral-800 text-neutral-100 text-[11px] px-2 py-0.5">
                      {u.role}
                    </span>
                  </div>
                  <span className="text-xs text-neutral-600">
                    {u.projectCount} project{u.projectCount === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <form
            action={createUser}
            className="grid grid-cols-[1fr_1fr_100px_auto] gap-2 pt-3 border-t border-dashed border-neutral-800"
          >
            <input
              name="email"
              type="email"
              required
              placeholder="email"
              className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm font-mono focus:outline-none focus:border-[#39ff88] focus:shadow-[0_0_0_1px_#39ff88,0_0_12px_-4px_rgba(57,255,136,0.55)]"
            />
            <input
              name="password"
              type="password"
              required
              placeholder="password"
              className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm font-mono focus:outline-none focus:border-[#39ff88] focus:shadow-[0_0_0_1px_#39ff88,0_0_12px_-4px_rgba(57,255,136,0.55)]"
            />
            <select
              name="role"
              defaultValue="user"
              className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm font-mono focus:outline-none focus:border-[#39ff88]"
            >
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
            <button
              type="submit"
              className="rounded-lg border border-[#39ff88] bg-[#39ff88] text-neutral-950 px-3.5 py-2 text-sm font-semibold hover:bg-[#5fff9f] shadow-[0_0_16px_-4px_rgba(57,255,136,0.55)]"
            >
              [create]
            </button>
          </form>
          {sp.ok ? (
            <p className="text-xs text-emerald-400">saved.</p>
          ) : sp.error ? (
            <p className="text-xs text-red-400">! {sp.error}</p>
          ) : null}
        </div>
      </section>

      <section className="space-y-2">
        <TermRule label={`all projects · ${allProjects.length}`} />
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-6">
          {allProjects.length === 0 ? (
            <p className="text-sm text-neutral-600">{"// no projects yet."}</p>
          ) : (
            <ul className="-mx-2">
              {allProjects.map((p, i) => (
                <li
                  key={p.id}
                  className={`flex items-center justify-between gap-3 px-2 py-2.5 ${
                    i === 0 ? "" : "border-t border-dashed border-neutral-800"
                  }`}
                >
                  <div className="min-w-0 flex-1 flex items-center gap-2.5">
                    <span className="text-neutral-600">&gt;</span>
                    <div className="min-w-0">
                      <Link
                        href={`/projects/${p.slug}`}
                        className="text-sm font-medium hover:underline hover:decoration-[#39ff88] underline-offset-[3px] truncate inline-block max-w-full"
                      >
                        {p.title}
                      </Link>
                      <div className="text-xs text-neutral-600 truncate">
                        by {p.ownerEmail} · /p/{p.slug}/
                      </div>
                    </div>
                  </div>
                  <div className="text-sm tabular-nums text-neutral-300 shrink-0">
                    {p.accessCount}{" "}
                    <span className="text-neutral-600 text-xs">hits</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
