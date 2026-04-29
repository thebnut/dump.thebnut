import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { createProject } from "@/lib/projects";

export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const sp = await searchParams;

  async function create(formData: FormData) {
    "use server";
    const session = await auth();
    if (!session?.user) redirect("/login");

    const file = formData.get("zip");
    if (!(file instanceof File) || file.size === 0) {
      redirect("/projects/new?error=missing-zip");
    }
    const title = String(formData.get("title") ?? "").trim();
    const slugRaw = String(formData.get("slug") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim() || null;
    const entryPath = String(formData.get("entryPath") ?? "").trim();
    const password = String(formData.get("password") ?? "").trim();
    const passwordLabel =
      String(formData.get("passwordLabel") ?? "").trim() || "default";

    if (!title) redirect("/projects/new?error=missing-title");

    const buf = await (file as File).arrayBuffer();

    try {
      const project = await createProject({
        ownerId: session.user.id,
        title,
        slug: slugRaw || undefined,
        description,
        entryPath: entryPath || undefined,
        zipBuffer: buf,
        passwords: password ? [{ label: passwordLabel, password }] : undefined,
      });
      redirect(`/projects/${project.slug}`);
    } catch (e) {
      // re-throw redirect (Next.js sentinel) so it actually navigates
      if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
      const msg = e instanceof Error ? e.message : "unknown";
      redirect(`/projects/new?error=${encodeURIComponent(msg)}`);
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">New project</h1>
        <Link
          href="/"
          className="text-sm text-neutral-400 hover:text-neutral-100"
        >
          ← back
        </Link>
      </div>

      {sp.error ? (
        <div className="rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {decodeURIComponent(sp.error)}
        </div>
      ) : null}

      <form
        action={create}
        encType="multipart/form-data"
        className="space-y-5 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6"
      >
        <Field label="Title" hint="Shown on your dashboard.">
          <input
            name="title"
            required
            className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-500"
          />
        </Field>

        <Field
          label="Slug (optional)"
          hint="The URL path. If blank, derived from the title. Letters, numbers, hyphens."
        >
          <input
            name="slug"
            placeholder="auto"
            className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-neutral-500"
          />
        </Field>

        <Field label="Description (optional)">
          <input
            name="description"
            className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-500"
          />
        </Field>

        <Field
          label="Entry file (optional)"
          hint="The HTML file served when someone hits /p/<slug>/. Defaults to index.html, then first .html in zip."
        >
          <input
            name="entryPath"
            placeholder="index.html"
            className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-neutral-500"
          />
        </Field>

        <Field
          label="Zip file"
          hint="Static files only (HTML, CSS, JS, images, fonts). 50 MB / 200 file limit."
        >
          <input
            name="zip"
            type="file"
            accept=".zip,application/zip"
            required
            className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-neutral-800 file:px-3 file:py-2 file:text-neutral-100 hover:file:bg-neutral-700"
          />
        </Field>

        <fieldset className="space-y-3 border-t border-neutral-800 pt-5">
          <legend className="text-sm text-neutral-300 -mt-9 bg-neutral-900/40 px-2">
            Optional password protection
          </legend>
          <Field
            label="Password label"
            hint="Stored in access logs to identify which password was used. e.g. 'martin', 'launch-team'."
          >
            <input
              name="passwordLabel"
              placeholder="default"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-500"
            />
          </Field>
          <Field
            label="Password"
            hint="Leave blank to publish unprotected."
          >
            <input
              name="password"
              type="password"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-500"
            />
          </Field>
        </fieldset>

        <div className="flex items-center justify-end gap-3 border-t border-neutral-800 pt-4">
          <Link
            href="/"
            className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800"
          >
            Cancel
          </Link>
          <button
            type="submit"
            className="rounded-lg bg-white text-neutral-900 px-3 py-1.5 text-sm font-medium hover:bg-neutral-200"
          >
            Publish
          </button>
        </div>
      </form>
    </main>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs uppercase tracking-wide text-neutral-400">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-neutral-500">{hint}</p> : null}
    </div>
  );
}
