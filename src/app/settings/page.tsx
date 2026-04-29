import { redirect } from "next/navigation";
import Link from "next/link";
import bcrypt from "bcryptjs";
import { eq, desc } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, apiTokens } from "@/lib/db/schema";
import { generateToken } from "@/lib/tokens";
import { TermRule } from "@/components/TermRule";

type Props = {
  searchParams: Promise<{
    new_token?: string;
    error?: string;
    ok?: string;
  }>;
};

export default async function SettingsPage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const sp = await searchParams;

  const tokens = await db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      prefix: apiTokens.prefix,
      createdAt: apiTokens.createdAt,
      lastUsedAt: apiTokens.lastUsedAt,
      revokedAt: apiTokens.revokedAt,
    })
    .from(apiTokens)
    .where(eq(apiTokens.userId, session.user.id))
    .orderBy(desc(apiTokens.createdAt));

  const activeTokens = tokens.filter((t) => !t.revokedAt);

  async function createApiToken(formData: FormData) {
    "use server";
    const session = await auth();
    if (!session?.user) redirect("/login");
    const name =
      String(formData.get("name") ?? "")
        .trim()
        .slice(0, 64) || "untitled";
    const t = generateToken();
    await db.insert(apiTokens).values({
      userId: session.user.id,
      name,
      tokenHash: t.hash,
      prefix: t.prefix,
    });
    redirect(`/settings?new_token=${encodeURIComponent(t.plaintext)}`);
  }

  async function revokeToken(formData: FormData) {
    "use server";
    const session = await auth();
    if (!session?.user) redirect("/login");
    const id = String(formData.get("id"));
    if (!id) return;
    await db
      .update(apiTokens)
      .set({ revokedAt: new Date() })
      .where(eq(apiTokens.id, id));
    redirect("/settings");
  }

  async function changePassword(formData: FormData) {
    "use server";
    const session = await auth();
    if (!session?.user) redirect("/login");
    const current = String(formData.get("currentPassword") ?? "");
    const next = String(formData.get("newPassword") ?? "");
    const confirm = String(formData.get("confirmPassword") ?? "");

    if (!current || !next) {
      redirect("/settings?error=missing");
    }
    if (next.length < 8) {
      redirect("/settings?error=too-short");
    }
    if (next !== confirm) {
      redirect("/settings?error=mismatch");
    }

    const found = await db
      .select()
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);
    const user = found[0];
    if (!user) redirect("/login");

    const ok = await bcrypt.compare(current, user.passwordHash);
    if (!ok) redirect("/settings?error=wrong-current");

    const hash = await bcrypt.hash(next, 10);
    await db
      .update(users)
      .set({ passwordHash: hash })
      .where(eq(users.id, session.user.id));

    redirect("/settings?ok=password");
  }

  const errorMsg: Record<string, string> = {
    missing: "fill all fields.",
    "too-short": "new password must be at least 8 characters.",
    mismatch: "new password and confirmation don't match.",
    "wrong-current": "current password is incorrect.",
  };

  return (
    <main className="mx-auto w-full max-w-3xl p-6 space-y-6 font-mono">
      <div>
        <Link
          href="/"
          className="text-sm text-neutral-500 hover:text-[#39ff88] transition-colors"
        >
          ← back
        </Link>
        <h1 className="text-2xl font-semibold mt-1">$ settings</h1>
        <p className="text-xs text-neutral-500 mt-1">
          <span className="text-neutral-600">// </span>
          api tokens for agents · password
        </p>
      </div>

      {sp.new_token ? <NewTokenBanner token={sp.new_token} /> : null}

      <section className="space-y-2">
        <TermRule label={`api tokens · ${activeTokens.length} active`} />
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
          <p className="text-xs text-neutral-500">
            <span className="text-neutral-600">// </span>
            tokens authenticate <code>POST /api/v1/projects</code> and friends.
            see{" "}
            <Link
              href="/api"
              className="text-[#39ff88] hover:underline underline-offset-[3px]"
            >
              /api
            </Link>{" "}
            for the full reference.
          </p>

          {tokens.length === 0 ? (
            <p className="text-sm text-neutral-600">// no tokens yet.</p>
          ) : (
            <ul className="-mx-2">
              {tokens.map((t, i) => {
                const revoked = !!t.revokedAt;
                return (
                  <li
                    key={t.id}
                    className={`flex items-center justify-between gap-3 px-2 py-2.5 ${
                      i === 0
                        ? ""
                        : "border-t border-dashed border-neutral-800"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <span
                        className={
                          revoked ? "text-neutral-700" : "text-[#39ff88]"
                        }
                      >
                        ●
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm truncate">{t.name}</div>
                        <div className="text-xs text-neutral-600 truncate">
                          {t.prefix} · created{" "}
                          {t.createdAt.toLocaleString()}
                          {t.lastUsedAt
                            ? ` · last used ${t.lastUsedAt.toLocaleString()}`
                            : " · never used"}
                          {revoked
                            ? ` · revoked ${t.revokedAt!.toLocaleString()}`
                            : ""}
                        </div>
                      </div>
                    </div>
                    {!revoked ? (
                      <form action={revokeToken}>
                        <input type="hidden" name="id" value={t.id} />
                        <button
                          type="submit"
                          className="text-xs text-red-400 hover:text-red-300"
                        >
                          [revoke]
                        </button>
                      </form>
                    ) : (
                      <span className="text-xs text-neutral-600">
                        revoked
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <form
            action={createApiToken}
            className="grid grid-cols-[1fr_auto] gap-2 pt-3 border-t border-dashed border-neutral-800"
          >
            <input
              name="name"
              required
              maxLength={64}
              placeholder="name (e.g. claude-code, ci-pipeline)"
              className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm font-mono focus:outline-none focus:border-[#39ff88] focus:shadow-[0_0_0_1px_#39ff88,0_0_12px_-4px_rgba(57,255,136,0.55)]"
            />
            <button
              type="submit"
              className="rounded-lg border border-[#39ff88] bg-[#39ff88] text-neutral-950 px-3.5 py-2 text-sm font-semibold hover:bg-[#5fff9f] shadow-[0_0_16px_-4px_rgba(57,255,136,0.55)]"
            >
              [create token]
            </button>
          </form>
        </div>
      </section>

      <section className="space-y-2">
        <TermRule label="password" />
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-3">
          <p className="text-xs text-neutral-500">
            <span className="text-neutral-600">// </span>
            change your sign-in password. minimum 8 characters.
          </p>
          <form action={changePassword} className="space-y-3">
            <Field label="current password">
              <Input name="currentPassword" type="password" required />
            </Field>
            <Field label="new password">
              <Input name="newPassword" type="password" required />
            </Field>
            <Field label="confirm new password">
              <Input name="confirmPassword" type="password" required />
            </Field>
            {sp.error && errorMsg[sp.error] ? (
              <p className="text-xs text-red-400">! {errorMsg[sp.error]}</p>
            ) : null}
            {sp.ok === "password" ? (
              <p className="text-xs text-emerald-400">password updated.</p>
            ) : null}
            <div className="flex justify-end pt-1">
              <button
                type="submit"
                className="rounded-lg border border-[#39ff88] bg-[#39ff88] text-neutral-950 px-3.5 py-1.5 text-sm font-semibold hover:bg-[#5fff9f] shadow-[0_0_16px_-4px_rgba(57,255,136,0.55)]"
              >
                [update password]
              </button>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}

function NewTokenBanner({ token }: { token: string }) {
  return (
    <div className="rounded-xl border border-[#39ff88]/40 bg-[rgba(57,255,136,0.05)] p-5 space-y-2 shadow-[0_0_24px_-8px_rgba(57,255,136,0.45)]">
      <p className="text-xs text-[#5fff9f] uppercase tracking-[0.1em]">
        ● token created · copy it now
      </p>
      <p className="text-xs text-neutral-400">
        <span className="text-neutral-600">// </span>
        this is the only time the plaintext token is shown. paste it into your
        agent / CI / .env now — we only store the hash.
      </p>
      <pre className="overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-xs text-[#39ff88] select-all">
        {token}
      </pre>
    </div>
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

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm font-mono focus:outline-none focus:border-[#39ff88] focus:shadow-[0_0_0_1px_#39ff88,0_0_12px_-4px_rgba(57,255,136,0.55)]"
    />
  );
}
