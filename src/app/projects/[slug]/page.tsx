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
import { TermRule } from "@/components/TermRule";

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
    <main className="mx-auto w-full max-w-5xl p-6 space-y-6 font-mono">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href="/"
            className="text-sm text-neutral-500 hover:text-[#39ff88] transition-colors"
          >
            ← back
          </Link>
          <h1 className="text-2xl font-semibold mt-1 truncate">
            {project.title}
          </h1>
          <p className="text-xs text-neutral-600 mt-1 truncate">
            /p/{project.slug}/ · {project.entryPath}
          </p>
        </div>
        <Link
          href={`/p/${project.slug}/`}
          target="_blank"
          className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800 whitespace-nowrap shrink-0"
        >
          [open ↗]
        </Link>
      </div>

      <section className="space-y-2">
        <TermRule label="settings" />
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-6">
          <form action={saveSettings} className="space-y-3">
            <Field label="title">
              <Input name="title" defaultValue={project.title} />
            </Field>
            <Field label="description">
              <Input
                name="description"
                defaultValue={project.description ?? ""}
              />
            </Field>
            <Field label="entry file">
              <Input name="entryPath" defaultValue={project.entryPath} />
            </Field>
            <div className="flex justify-end pt-1">
              <button
                type="submit"
                className="rounded-lg border border-[#39ff88] bg-[#39ff88] text-neutral-950 px-3.5 py-1.5 text-sm font-semibold hover:bg-[#5fff9f] shadow-[0_0_16px_-4px_rgba(57,255,136,0.55)]"
              >
                [save]
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="space-y-2">
        <TermRule label={`passwords · ${passwords.length}`} />
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
          <p className="text-xs text-neutral-500">
            <span className="text-neutral-600">// </span>
            {project.isProtected
              ? "protected — at least one password required."
              : "unprotected — direct link grants access."}
          </p>

          {passwords.length > 0 ? (
            <ul className="-mx-2">
              {passwords.map((p, i) => (
                <li
                  key={p.id}
                  className={`flex items-center justify-between px-2 py-2.5 ${
                    i === 0 ? "" : "border-t border-dashed border-neutral-800"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-neutral-600">●</span>
                    <span className="text-sm">{p.label}</span>
                    <span className="text-xs text-neutral-600">
                      added {p.createdAt.toLocaleString()}
                    </span>
                  </div>
                  <form action={removePassword}>
                    <input type="hidden" name="id" value={p.id} />
                    <button
                      type="submit"
                      className="text-xs text-red-400 hover:text-red-300 hover:[text-shadow:0_0_8px_rgba(248,113,113,0.4)]"
                    >
                      [remove]
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-neutral-600">// no passwords set.</p>
          )}

          <form
            action={addPassword}
            className="grid grid-cols-[1fr_1fr_auto] gap-2 pt-3 border-t border-dashed border-neutral-800"
          >
            <Input name="label" placeholder="label (e.g. martin)" />
            <Input name="password" type="password" required placeholder="password" />
            <button
              type="submit"
              className="rounded-lg border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-800 whitespace-nowrap"
            >
              [add]
            </button>
          </form>
        </div>
      </section>

      <section className="space-y-2">
        <TermRule label={`access log · ${logs.length}`} />
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 overflow-hidden">
          {logs.length === 0 ? (
            <p className="text-sm text-neutral-600 p-6">// no hits yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-[10px] text-neutral-600 uppercase tracking-[0.12em] bg-neutral-900/40">
                  <tr>
                    <th className="text-left font-normal px-4 py-2.5">when</th>
                    <th className="text-left font-normal px-3 py-2.5">ip</th>
                    <th className="text-left font-normal px-3 py-2.5">path</th>
                    <th className="text-left font-normal px-3 py-2.5">password</th>
                    <th className="text-left font-normal px-4 py-2.5">ua</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => (
                    <tr
                      key={l.id}
                      className="border-t border-dashed border-neutral-800"
                    >
                      <td className="px-4 py-2 whitespace-nowrap text-neutral-300">
                        {l.ts.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-neutral-300">
                        {l.ip ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-neutral-300">
                        {l.path ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-neutral-100">
                        {l.passwordLabelUsed ?? (
                          <span className="text-neutral-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-neutral-400 truncate max-w-[24ch]">
                        {l.userAgent ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="space-y-2">
        <TermRule label="danger zone" tone="danger" />
        <div className="rounded-xl border border-red-900/40 bg-red-950/20 p-6 space-y-3">
          <p className="text-xs text-red-300">
            <span className="text-red-400/60">// </span>this cannot be undone.
            files in blob storage are removed too.
          </p>
          <form action={destroy}>
            <button
              type="submit"
              className="rounded-lg border border-red-700 text-red-300 px-3 py-1.5 text-sm hover:bg-red-900/30"
            >
              [ delete project (and all files) ]
            </button>
          </form>
        </div>
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
      <label className="text-xs uppercase tracking-wide text-neutral-500">
        {label}
      </label>
      {children}
    </div>
  );
}

function Input(
  props: React.InputHTMLAttributes<HTMLInputElement>,
) {
  return (
    <input
      {...props}
      className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm font-mono focus:outline-none focus:border-[#39ff88] focus:shadow-[0_0_0_1px_#39ff88,0_0_12px_-4px_rgba(57,255,136,0.55)]"
    />
  );
}
