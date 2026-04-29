import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import {
  projectBySlugForUser,
  logsForProject,
  passwordsForProject,
} from "@/lib/queries";
import {
  addProjectPassword,
  removeProjectPassword,
  deleteProject,
  updateProject,
} from "@/lib/projects";

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function ProjectManagePage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { slug } = await params;
  const isAdmin = session.user.role === "admin";

  const project = await projectBySlugForUser(slug, session.user.id, isAdmin);
  if (!project) notFound();

  const [logs, passwords] = await Promise.all([
    logsForProject(project.id),
    passwordsForProject(project.id),
  ]);

  async function addPassword(formData: FormData) {
    "use server";
    const session = await auth();
    if (!session?.user) redirect("/login");
    const proj = await projectBySlugForUser(
      slug,
      session.user.id,
      session.user.role === "admin",
    );
    if (!proj) return;
    const label = String(formData.get("label") ?? "").trim() || "default";
    const pw = String(formData.get("password") ?? "");
    if (!pw) return;
    await addProjectPassword(proj.id, label, pw);
    redirect(`/projects/${slug}`);
  }

  async function removePassword(formData: FormData) {
    "use server";
    const session = await auth();
    if (!session?.user) redirect("/login");
    const proj = await projectBySlugForUser(
      slug,
      session.user.id,
      session.user.role === "admin",
    );
    if (!proj) return;
    const id = String(formData.get("id"));
    if (!id) return;
    await removeProjectPassword(proj.id, id);
    redirect(`/projects/${slug}`);
  }

  async function saveSettings(formData: FormData) {
    "use server";
    const session = await auth();
    if (!session?.user) redirect("/login");
    const proj = await projectBySlugForUser(
      slug,
      session.user.id,
      session.user.role === "admin",
    );
    if (!proj) return;
    await updateProject(proj.id, {
      title: String(formData.get("title") ?? proj.title),
      description: String(formData.get("description") ?? "") || null,
      entryPath: String(formData.get("entryPath") ?? proj.entryPath),
    });
    redirect(`/projects/${slug}`);
  }

  async function destroy() {
    "use server";
    const session = await auth();
    if (!session?.user) redirect("/login");
    const proj = await projectBySlugForUser(
      slug,
      session.user.id,
      session.user.role === "admin",
    );
    if (!proj) return;
    await deleteProject(proj.id);
    redirect("/");
  }

  return (
    <main className="mx-auto w-full max-w-4xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/"
            className="text-sm text-neutral-400 hover:text-neutral-100"
          >
            ← back
          </Link>
          <h1 className="text-2xl font-semibold mt-1">{project.title}</h1>
          <p className="text-xs text-neutral-500 font-mono">/p/{project.slug}/</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/p/${project.slug}/`}
            target="_blank"
            className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800"
          >
            Open ↗
          </Link>
        </div>
      </div>

      <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
        <h2 className="text-sm uppercase tracking-wide text-neutral-400">
          Settings
        </h2>
        <form action={saveSettings} className="space-y-3">
          <Field label="Title">
            <input
              name="title"
              defaultValue={project.title}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Description">
            <input
              name="description"
              defaultValue={project.description ?? ""}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Entry file">
            <input
              name="entryPath"
              defaultValue={project.entryPath}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm font-mono"
            />
          </Field>
          <div className="flex justify-end">
            <button
              type="submit"
              className="rounded-lg bg-white text-neutral-900 px-3 py-1.5 text-sm font-medium hover:bg-neutral-200"
            >
              Save
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm uppercase tracking-wide text-neutral-400">
            Passwords
          </h2>
          <span className="text-xs text-neutral-500">
            {project.isProtected
              ? "Protected — at least one password required."
              : "Unprotected — direct link grants access."}
          </span>
        </div>

        {passwords.length > 0 ? (
          <ul className="divide-y divide-neutral-800 -mx-2">
            {passwords.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between px-2 py-2"
              >
                <div>
                  <span className="text-sm">{p.label}</span>
                  <span className="ml-2 text-xs text-neutral-500">
                    added {p.createdAt.toLocaleString()}
                  </span>
                </div>
                <form action={removePassword}>
                  <input type="hidden" name="id" value={p.id} />
                  <button
                    type="submit"
                    className="text-xs text-red-400 hover:text-red-300"
                  >
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-neutral-500">No passwords set.</p>
        )}

        <form
          action={addPassword}
          className="grid grid-cols-[1fr_1fr_auto] gap-2 pt-2 border-t border-neutral-800"
        >
          <input
            name="label"
            placeholder="Label (e.g. martin)"
            className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
          />
          <input
            name="password"
            type="password"
            required
            placeholder="Password"
            className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded-lg border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-800"
          >
            Add
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-3">
        <h2 className="text-sm uppercase tracking-wide text-neutral-400">
          Access log ({logs.length})
        </h2>
        {logs.length === 0 ? (
          <p className="text-sm text-neutral-500">No hits yet.</p>
        ) : (
          <div className="overflow-x-auto -mx-6">
            <table className="w-full text-sm">
              <thead className="text-xs text-neutral-500 uppercase tracking-wide">
                <tr>
                  <th className="text-left font-normal px-6 py-2">When</th>
                  <th className="text-left font-normal px-3 py-2">IP</th>
                  <th className="text-left font-normal px-3 py-2">Path</th>
                  <th className="text-left font-normal px-3 py-2">Password</th>
                  <th className="text-left font-normal px-6 py-2">UA</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr
                    key={l.id}
                    className="border-t border-neutral-800/60"
                  >
                    <td className="px-6 py-2 whitespace-nowrap font-mono text-xs">
                      {l.ts.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {l.ip ?? "—"}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {l.path ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {l.passwordLabelUsed ?? (
                        <span className="text-neutral-600">none</span>
                      )}
                    </td>
                    <td className="px-6 py-2 text-xs text-neutral-400 truncate max-w-[20ch]">
                      {l.userAgent ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-red-900/40 bg-red-950/20 p-6 space-y-3">
        <h2 className="text-sm uppercase tracking-wide text-red-300">
          Danger zone
        </h2>
        <form action={destroy}>
          <button
            type="submit"
            className="rounded-lg border border-red-700 text-red-300 px-3 py-1.5 text-sm hover:bg-red-900/30"
          >
            Delete project (and all files)
          </button>
        </form>
      </section>
    </main>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs uppercase tracking-wide text-neutral-400">
        {label}
      </label>
      {children}
    </div>
  );
}
