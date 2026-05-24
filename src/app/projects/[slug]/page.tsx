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
  updateProjectPassword,
  deleteProject,
  updateProject,
  parseExpiresIn,
} from "@/lib/projects";
import { TermRule } from "@/components/TermRule";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ edit?: string; ok?: string }>;
  // `ok` values used: password-updated, ttl-set, ttl-cleared, ttl-invalid
};

export default async function ProjectManagePage({
  params,
  searchParams,
}: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { slug } = await params;
  const sp = await searchParams;
  const editingPasswordId = sp.edit ?? null;
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

  async function changePassword(formData: FormData) {
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
    const pw = String(formData.get("password") ?? "");
    if (!id || !pw) return;
    await updateProjectPassword(proj.id, id, pw);
    redirect(`/projects/${slug}?ok=password-updated`);
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

  async function updateExpiry(formData: FormData) {
    "use server";
    const session = await auth();
    if (!session?.user) redirect("/login");
    const proj = await projectBySlugForUser(
      slug,
      session.user.id,
      session.user.role === "admin",
    );
    if (!proj) return;

    const action = String(formData.get("action") ?? "");
    if (action === "clear") {
      await updateProject(proj.id, { expiresAt: null });
      redirect(`/projects/${slug}?ok=ttl-cleared`);
    }
    if (action === "set") {
      // Two inputs: a preset (`ttl`) or an absolute datetime-local (`ttlAt`).
      // ttlAt wins when provided; otherwise ttl is a duration string parsed by parseExpiresIn.
      const ttlAt = String(formData.get("ttlAt") ?? "").trim();
      const ttl = String(formData.get("ttl") ?? "").trim();
      let when: Date | null = null;
      if (ttlAt) {
        const d = new Date(ttlAt);
        if (!isNaN(d.getTime())) when = d;
      } else if (ttl) {
        const ms = parseExpiresIn(ttl);
        if (ms != null) when = new Date(Date.now() + ms);
      }
      if (!when) redirect(`/projects/${slug}?ok=ttl-invalid`);
      await updateProject(proj.id, { expiresAt: when });
      redirect(`/projects/${slug}?ok=ttl-set`);
    }
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
        <TermRule label="auto-expire (ttl)" />
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-3">
          <ExpiryStatus expiresAt={project.expiresAt} />
          {sp.ok === "ttl-set" ? (
            <p className="text-xs text-emerald-400">expiry updated.</p>
          ) : null}
          {sp.ok === "ttl-cleared" ? (
            <p className="text-xs text-emerald-400">expiry cleared.</p>
          ) : null}
          {sp.ok === "ttl-invalid" ? (
            <p className="text-xs text-red-400">
              ! couldn&apos;t parse that — pick a preset or enter a future date.
            </p>
          ) : null}

          <form
            action={updateExpiry}
            className="grid grid-cols-[auto_1fr_auto_auto] gap-2 items-center pt-3 border-t border-dashed border-neutral-800"
          >
            <input type="hidden" name="action" value="set" />
            <select
              name="ttl"
              defaultValue=""
              className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm font-mono focus:outline-none focus:border-[#39ff88]"
            >
              <option value="">preset…</option>
              <option value="1h">1 hour</option>
              <option value="6h">6 hours</option>
              <option value="24h">24 hours</option>
              <option value="7d">7 days</option>
              <option value="30d">30 days</option>
            </select>
            <Input
              type="datetime-local"
              name="ttlAt"
              aria-label="custom date-time"
              title="…or pick a custom date-time (overrides preset)"
            />
            <button
              type="submit"
              className="rounded-lg border border-[#39ff88] bg-[#39ff88] text-neutral-950 px-3 py-2 text-sm font-semibold hover:bg-[#5fff9f] whitespace-nowrap"
            >
              [set]
            </button>
            {project.expiresAt ? (
              <button
                type="submit"
                formAction={updateExpiry}
                name="action"
                value="clear"
                className="rounded-lg border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-800 whitespace-nowrap"
              >
                [clear]
              </button>
            ) : (
              <span />
            )}
          </form>
          <p className="text-xs text-neutral-500">
            <span className="text-neutral-600">{"// "}</span>
            expired projects 410-gone immediately; files are hard-deleted on the next hourly cron.
          </p>
        </div>
      </section>

      <section className="space-y-2">
        <TermRule label={`passwords · ${passwords.length}`} />
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
          <p className="text-xs text-neutral-500">
            <span className="text-neutral-600">{"// "}</span>
            {project.isProtected
              ? "protected — at least one password required."
              : "unprotected — direct link grants access."}
          </p>

          {sp.ok === "password-updated" ? (
            <p className="text-xs text-emerald-400">password updated.</p>
          ) : null}

          {passwords.length > 0 ? (
            <ul className="-mx-2">
              {passwords.map((p, i) => {
                const isEditing = editingPasswordId === p.id;
                return (
                  <li
                    key={p.id}
                    className={`px-2 py-2.5 ${
                      i === 0
                        ? ""
                        : "border-t border-dashed border-neutral-800"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className="text-neutral-600">●</span>
                        <span className="text-sm">{p.label}</span>
                        <span className="text-xs text-neutral-600">
                          added {p.createdAt.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        {isEditing ? (
                          <Link
                            href={`/projects/${slug}`}
                            className="text-xs text-neutral-500 hover:text-neutral-100"
                          >
                            [cancel]
                          </Link>
                        ) : (
                          <Link
                            href={`/projects/${slug}?edit=${p.id}`}
                            className="text-xs text-neutral-400 hover:text-[#39ff88]"
                          >
                            [change]
                          </Link>
                        )}
                        <form action={removePassword}>
                          <input type="hidden" name="id" value={p.id} />
                          <button
                            type="submit"
                            className="text-xs text-red-400 hover:text-red-300 hover:[text-shadow:0_0_8px_rgba(248,113,113,0.4)]"
                          >
                            [remove]
                          </button>
                        </form>
                      </div>
                    </div>
                    {isEditing ? (
                      <form
                        action={changePassword}
                        className="grid grid-cols-[1fr_auto] gap-2 mt-2.5 ml-[22px]"
                      >
                        <input type="hidden" name="id" value={p.id} />
                        <Input
                          name="password"
                          type="password"
                          required
                          autoFocus
                          placeholder="new password"
                        />
                        <button
                          type="submit"
                          className="rounded-lg border border-[#39ff88] bg-[#39ff88] text-neutral-950 px-3 py-2 text-sm font-semibold hover:bg-[#5fff9f] shadow-[0_0_16px_-4px_rgba(57,255,136,0.55)] whitespace-nowrap"
                        >
                          [save]
                        </button>
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-neutral-600">{"// no passwords set."}</p>
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
            <p className="text-sm text-neutral-600 p-6">{"// no hits yet."}</p>
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
            <span className="text-red-400/60">{"// "}</span>this cannot be undone.
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

function ExpiryStatus({ expiresAt }: { expiresAt: Date | null }) {
  if (!expiresAt) {
    return (
      <p className="text-sm text-neutral-300">
        <span className="text-neutral-600">{"// "}</span>
        permanent — no expiry set.
      </p>
    );
  }
  const past = expiresAt.getTime() <= Date.now();
  const rel = humaniseDelta(expiresAt.getTime() - Date.now());
  return (
    <div className="space-y-1">
      <p className="text-sm">
        {past ? (
          <>
            <span className="text-red-400">expired</span>{" "}
            <span className="text-neutral-500">{rel} ago — pending cleanup</span>
          </>
        ) : (
          <>
            <span className="text-neutral-300">expires in </span>
            <span className="text-[#39ff88]">{rel}</span>
          </>
        )}
      </p>
      <p className="text-xs text-neutral-600">{expiresAt.toLocaleString()}</p>
    </div>
  );
}

// Human-readable elapsed-time string for absolute values like "3h", "2d".
// Negative input (past) is shown as positive; caller decides which side
// of "ago / in" to put it on.
function humaniseDelta(ms: number): string {
  const abs = Math.abs(ms);
  const minute = 60_000;
  const hour = 3_600_000;
  const day = 86_400_000;
  if (abs < hour) return `${Math.max(1, Math.round(abs / minute))}m`;
  if (abs < day) return `${Math.round(abs / hour)}h`;
  return `${Math.round(abs / day)}d`;
}
