import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { createProject } from "@/lib/projects";
import { TermRule } from "@/components/TermRule";
import { UploadDropzone } from "@/components/UploadDropzone";

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
      redirect("/projects/new?error=missing-file");
    }
    const title = String(formData.get("title") ?? "").trim();
    const slugRaw = String(formData.get("slug") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim() || null;
    const entryPath = String(formData.get("entryPath") ?? "").trim();
    const password = String(formData.get("password") ?? "").trim();
    const passwordLabel =
      String(formData.get("passwordLabel") ?? "").trim() || "default";

    if (!title) redirect("/projects/new?error=missing-title");

    const f = file as File;
    const buf = await f.arrayBuffer();

    try {
      const project = await createProject({
        ownerId: session.user.id,
        title,
        slug: slugRaw || undefined,
        description,
        entryPath: entryPath || undefined,
        zipBuffer: buf,
        originalFilename: f.name,
        passwords: password ? [{ label: passwordLabel, password }] : undefined,
      });
      redirect(`/projects/${project.slug}`);
    } catch (e) {
      if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
      const msg = e instanceof Error ? e.message : "unknown";
      redirect(`/projects/new?error=${encodeURIComponent(msg)}`);
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl p-6 space-y-6 font-mono">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/"
            className="text-sm text-neutral-500 hover:text-[#39ff88] transition-colors"
          >
            ← back
          </Link>
          <h1 className="text-2xl font-semibold mt-1">$ new project</h1>
          <p className="text-xs text-neutral-500 mt-1">
            <span className="text-neutral-600">{"// "}</span>upload a zip of static
            files. 50 MB / 200 file limit.
          </p>
        </div>
      </div>

      {sp.error ? (
        <div className="rounded-lg border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          ! {decodeURIComponent(sp.error)}
        </div>
      ) : null}

      <form
        action={create}
        encType="multipart/form-data"
        className="space-y-5 rounded-xl border border-neutral-800 bg-neutral-900/40 p-6"
      >
        <Field label="title" hint="Shown on your dashboard.">
          <Input name="title" required />
        </Field>

        <Field
          label="slug (optional)"
          hint="The URL path. If blank, derived from the title. Letters, numbers, hyphens."
        >
          <Input name="slug" placeholder="auto" />
        </Field>

        <Field label="description (optional)">
          <Input name="description" />
        </Field>

        <Field
          label="entry file (optional)"
          hint="Served when someone hits /p/<slug>/. Defaults to index.html, then first .html in zip. Ignored for single-html uploads."
        >
          <Input name="entryPath" placeholder="index.html" />
        </Field>

        <Field
          label="upload"
          hint="A .zip of static files OR a single .html file. 50 MB cap."
        >
          <UploadDropzone name="zip" required />
        </Field>

        <div className="pt-2">
          <TermRule label="optional password protection" />
        </div>

        <Field
          label="password label"
          hint="Stored in access logs to identify which password was used. e.g. 'martin', 'launch-team'."
        >
          <Input name="passwordLabel" placeholder="default" />
        </Field>
        <Field label="password" hint="Leave blank to publish unprotected.">
          <Input name="password" type="password" />
        </Field>

        <div className="flex items-center justify-end gap-3 border-t border-dashed border-neutral-800 pt-4 mt-1">
          <Link
            href="/"
            className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800"
          >
            [cancel]
          </Link>
          <button
            type="submit"
            className="rounded-lg border border-[#39ff88] bg-[#39ff88] text-neutral-950 px-3.5 py-1.5 text-sm font-semibold hover:bg-[#5fff9f] shadow-[0_0_16px_-4px_rgba(57,255,136,0.55)] hover:shadow-[0_0_22px_-2px_rgba(57,255,136,0.55)]"
          >
            [ publish ]
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
      <label className="text-xs uppercase tracking-wide text-neutral-500">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-neutral-500">{hint}</p> : null}
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
