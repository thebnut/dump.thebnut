import Link from "next/link";
import { Logo } from "@/components/Logo";
import { TermRule } from "@/components/TermRule";

export const metadata = {
  title: "API · dump.thebnut",
  description: "Programmatic upload + management for dump.thebnut prototypes.",
};

export default function ApiDocsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl p-6 space-y-6 font-mono">
      <header>
        <Logo size="md" href="/" />
        <h1 className="text-2xl font-semibold mt-3">$ api · v1</h1>
        <p className="text-xs text-neutral-500 mt-1">
          <span className="text-neutral-600">{"// "}</span>
          programmatic upload + management. for agents, scripts, ci.
        </p>
      </header>

      <section className="rounded-xl border border-[#39ff88]/40 bg-[rgba(57,255,136,0.05)] p-5 shadow-[0_0_24px_-8px_rgba(57,255,136,0.45)] space-y-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <p className="text-xs text-[#5fff9f] uppercase tracking-[0.1em]">
              ● claude / openclaw skill
            </p>
            <p className="text-sm text-neutral-100 mt-1.5">
              Download and install this skill.
            </p>
            <p className="text-xs text-neutral-500 mt-1">
              <span className="text-neutral-600">{"// "}</span>
              the agent uploads any folder or html file when you say
              &ldquo;dump this&rdquo;. only requires{" "}
              <Code>DUMP_TOKEN</Code> in the env.
            </p>
          </div>
          <a
            href="/dump-thebnut.skill.md"
            download="dump-thebnut.md"
            className="rounded-lg border border-[#39ff88] bg-[#39ff88] text-neutral-950 px-3.5 py-1.5 text-sm font-semibold hover:bg-[#5fff9f] shadow-[0_0_16px_-4px_rgba(57,255,136,0.55)] hover:shadow-[0_0_22px_-2px_rgba(57,255,136,0.55)] whitespace-nowrap shrink-0"
          >
            [download skill]
          </a>
        </div>

        <div className="border-t border-dashed border-[#39ff88]/30 pt-4">
          <p className="text-[11px] uppercase tracking-wide text-neutral-500">
            or just give your agent the url
          </p>
          <div className="mt-2 rounded-lg border border-neutral-800 bg-neutral-950/80 p-4 space-y-2">
            <p className="text-[11px] uppercase tracking-[0.08em] text-neutral-600">
              you ▸ claude
            </p>
            <p className="text-sm text-neutral-100 leading-relaxed">
              install this skill so you can publish prototypes for me:
              <br />
              <Code>https://dump.thebnut.com/dump-thebnut.skill.md</Code>
            </p>
          </div>
          <p className="text-xs text-neutral-500 mt-2">
            <span className="text-neutral-600">{"// "}</span>
            then create a token at{" "}
            <Lk href="/settings">/settings</Lk> and tell the agent the
            value when it asks.
          </p>
        </div>
      </section>

      <Section label="auth">
        <P>
          All endpoints require a bearer token. Generate one at{" "}
          <Lk href="/settings">/settings</Lk>. Tokens are scoped to your user
          and can do anything you can do via the dashboard.
        </P>
        <Pre>{`Authorization: Bearer dt_live_…`}</Pre>
      </Section>

      <Section label="endpoints">
        <Table
          rows={[
            ["POST", "/api/v1/projects", "create from zip"],
            ["GET", "/api/v1/projects", "list your projects"],
            ["GET", "/api/v1/projects/{slug}", "single project"],
            ["PATCH", "/api/v1/projects/{slug}", "update title/description/entry"],
            ["DELETE", "/api/v1/projects/{slug}", "delete project + files"],
            ["POST", "/api/v1/projects/{slug}/zip", "wipe + replace files"],
            ["GET", "/api/v1/projects/{slug}/logs", "access log (limit ≤ 1000)"],
            ["GET", "/api/v1/projects/{slug}/passwords", "list password labels"],
            ["POST", "/api/v1/projects/{slug}/passwords", "add a password"],
            [
              "PATCH",
              "/api/v1/projects/{slug}/passwords/{id}",
              "change a password's value",
            ],
            [
              "DELETE",
              "/api/v1/projects/{slug}/passwords/{id}",
              "remove a password",
            ],
          ]}
        />
      </Section>

      <Section label="upload — multipart/form-data">
        <P>
          The <Code>POST /projects</Code> and <Code>POST /projects/{`{slug}`}/zip</Code>{" "}
          endpoints take <Code>multipart/form-data</Code>. Other endpoints
          take JSON.
        </P>
        <P>
          <span className="text-neutral-500">
            <span className="text-neutral-600">{"// "}</span>
            the upload field accepts <Code>.zip</Code> (static folder) OR{" "}
            <Code>.html</Code>/<Code>.htm</Code> (single file — handy for
            AI-generated mockups). single-html uploads are stored at{" "}
            <Code>index.html</Code>.
          </span>
        </P>
        <Table
          rows={[
            ["title", "required", "shown on the dashboard"],
            [
              "file",
              "required",
              ".zip OR .html; 50 MB cap (also accepts legacy 'zip')",
            ],
            ["slug", "optional", "url path; if blank, derived from title"],
            ["description", "optional", ""],
            [
              "entryPath",
              "optional",
              "default index.html → first .html (zip only)",
            ],
            ["password", "optional", "if set, project is gated"],
            [
              "passwordLabel",
              "optional",
              "label shown in access log; default 'default'",
            ],
          ]}
        />
      </Section>

      <Section label="errors">
        <P>All errors return JSON with this envelope:</P>
        <Pre>{`{ "error": { "code": "slug_taken", "message": "Slug already taken: foo" } }`}</Pre>
        <P>
          Codes: <Code>unauthorized</Code> (401), <Code>forbidden</Code> (403),{" "}
          <Code>not_found</Code> (404), <Code>missing_field</Code> (400),{" "}
          <Code>slug_taken</Code> (409), <Code>zip_too_large</Code> (413),{" "}
          <Code>zip_invalid</Code> (400), <Code>rate_limited</Code> (429),{" "}
          <Code>internal_error</Code> (500).
        </P>
        <P>
          Rate limits: 60 req/min per token; uploads (create / replace) capped at
          10/min.
        </P>
      </Section>

      <Section label="curl recipes">
        <Sub>Create from a zip</Sub>
        <Pre>{`curl -X POST https://dump.thebnut.com/api/v1/projects \\
  -H "Authorization: Bearer $DUMP_TOKEN" \\
  -F "title=Marketing v3" \\
  -F "slug=marketing-v3" \\
  -F "entryPath=index.html" \\
  -F "file=@./marketing-v3.zip"`}</Pre>

        <Sub>Create from a single HTML file</Sub>
        <Pre>{`curl -X POST https://dump.thebnut.com/api/v1/projects \\
  -H "Authorization: Bearer $DUMP_TOKEN" \\
  -F "title=Quick mockup" \\
  -F "file=@./mockup.html"`}</Pre>

        <Sub>Re-upload (wipe + replace)</Sub>
        <Pre>{`curl -X POST https://dump.thebnut.com/api/v1/projects/marketing-v3/zip \\
  -H "Authorization: Bearer $DUMP_TOKEN" \\
  -F "file=@./marketing-v3.zip"
# (also accepts a single .html for the same project)`}</Pre>

        <Sub>List projects</Sub>
        <Pre>{`curl https://dump.thebnut.com/api/v1/projects \\
  -H "Authorization: Bearer $DUMP_TOKEN"`}</Pre>

        <Sub>Add a password</Sub>
        <Pre>{`curl -X POST https://dump.thebnut.com/api/v1/projects/marketing-v3/passwords \\
  -H "Authorization: Bearer $DUMP_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"label":"launch-team","password":"secret123"}'`}</Pre>

        <Sub>Delete</Sub>
        <Pre>{`curl -X DELETE https://dump.thebnut.com/api/v1/projects/marketing-v3 \\
  -H "Authorization: Bearer $DUMP_TOKEN"`}</Pre>
      </Section>

      <Section label="claude code recipe">
        <P>
          Drop this in a Claude Code conversation to upload from any folder:
        </P>
        <Pre>{`# from a folder
cd path/to/prototype
zip -r /tmp/dump.zip . -x "*.DS_Store" "__MACOSX/*"
curl -sS -X POST https://dump.thebnut.com/api/v1/projects \\
  -H "Authorization: Bearer $DUMP_TOKEN" \\
  -F "title=$(basename $PWD)" \\
  -F "file=@/tmp/dump.zip" | jq .project.url

# or from a single HTML file
curl -sS -X POST https://dump.thebnut.com/api/v1/projects \\
  -H "Authorization: Bearer $DUMP_TOKEN" \\
  -F "title=ai-mockup" \\
  -F "file=@./mockup.html" | jq .project.url`}</Pre>
      </Section>

      <p className="text-xs text-neutral-600 pt-2">
        <span className="text-neutral-700">{"// "}</span>
        v1 — additive changes only. anything breaking will land at /api/v2.
      </p>
    </main>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <TermRule label={label} />
      <div className="space-y-3 text-sm text-neutral-300">{children}</div>
    </section>
  );
}

function Sub({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs uppercase tracking-wide text-neutral-500 pt-2">
      {children}
    </h3>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-neutral-300 leading-relaxed">{children}</p>;
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-neutral-900 border border-neutral-800 px-1.5 py-0.5 text-xs text-[#39ff88]">
      {children}
    </code>
  );
}

function Pre({ children }: { children: React.ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-950 p-4 text-xs text-neutral-200 leading-relaxed whitespace-pre">
      {children}
    </pre>
  );
}

function Lk({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="text-[#39ff88] hover:underline underline-offset-[3px]"
    >
      {children}
    </Link>
  );
}

function Table({ rows }: { rows: Array<[string, string, string]> }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-800">
      <table className="w-full text-xs">
        <tbody>
          {rows.map(([a, b, c], i) => (
            <tr
              key={`${a}-${b}-${i}`}
              className={i === 0 ? "" : "border-t border-dashed border-neutral-800"}
            >
              <td className="px-3 py-2 font-semibold text-[#39ff88] whitespace-nowrap w-16">
                {a}
              </td>
              <td className="px-3 py-2 text-neutral-100 whitespace-nowrap">
                {b}
              </td>
              <td className="px-3 py-2 text-neutral-500">{c}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
