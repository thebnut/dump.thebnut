import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { signIn, auth } from "@/lib/auth";
import { AuthError } from "next-auth";
import { Logo } from "@/components/Logo";
import { localCallback } from "@/lib/oauth-policy";
import { ipFromHeaders } from "@/lib/util";
import { rateLimit, RL_AUTH } from "@/lib/rate-limit";

type Props = {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
};

export default async function LoginPage({ searchParams }: Props) {
  const session = await auth();
  const sp = await searchParams;
  const callbackUrl = localCallback(sp.callbackUrl);
  if (session?.user?.id) redirect(callbackUrl);
  const error = sp.error;

  async function login(formData: FormData) {
    "use server";
    // Rate-limit BEFORE signIn so bcrypt.compare doesn't run on attempts
    // we're going to reject anyway. Two buckets: per-IP overall (10/min)
    // catches a single bot trying many emails; per-(IP, email) (also
    // 10/min) caps grinding on one account — combined IP+email keying
    // means a distributed attacker spamming someone's email can't lock
    // the victim out from their own IP.
    const h = await headers();
    const ip = ipFromHeaders(h) ?? "unknown";
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const ipRl = rateLimit(`login:ip:${ip}`, RL_AUTH);
    if (!ipRl.allowed) redirect(`/login?error=rate_limited&callbackUrl=${encodeURIComponent(callbackUrl)}`);
    if (email) {
      const idRl = rateLimit(`login:${ip}:${email}`, RL_AUTH);
      if (!idRl.allowed) redirect(`/login?error=rate_limited&callbackUrl=${encodeURIComponent(callbackUrl)}`);
    }

    try {
      await signIn("credentials", {
        email: String(formData.get("email") ?? ""),
        password: String(formData.get("password") ?? ""),
        redirectTo: callbackUrl,
      });
    } catch (e) {
      if (e instanceof AuthError) {
        redirect(`/login?error=invalid&callbackUrl=${encodeURIComponent(callbackUrl)}`);
      }
      throw e;
    }
  }

  return (
    <main className="min-h-dvh grid place-items-center bg-neutral-950 text-neutral-100 p-6 font-mono">
      <form
        action={login}
        className="w-full max-w-md space-y-5 rounded-xl border border-neutral-800 bg-neutral-900/50 p-7"
      >
        <div className="flex items-center justify-between">
          <Logo size="md" />
          <span className="text-[11px] text-neutral-500 uppercase tracking-[0.1em]">
            auth · v1
          </span>
        </div>

        <pre className="text-xs text-neutral-500 m-0 whitespace-pre-wrap">
          {`$ ssh dump.thebnut.com
# sign in to view your dump`}
        </pre>

        <div className="space-y-1.5">
          <label
            htmlFor="email"
            className="text-xs uppercase tracking-wide text-neutral-500"
          >
            email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm font-mono focus:outline-none focus:border-[#39ff88] focus:shadow-[0_0_0_1px_#39ff88,0_0_12px_-4px_rgba(57,255,136,0.55)]"
          />
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="password"
            className="text-xs uppercase tracking-wide text-neutral-500"
          >
            password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm font-mono focus:outline-none focus:border-[#39ff88] focus:shadow-[0_0_0_1px_#39ff88,0_0_12px_-4px_rgba(57,255,136,0.55)]"
          />
        </div>

        {error === "rate_limited" ? (
          <p className="text-xs text-amber-400">
            ! too many attempts. wait a minute and try again.
          </p>
        ) : error ? (
          <p className="text-xs text-red-400">! invalid email or password.</p>
        ) : null}

        <button
          type="submit"
          className="w-full rounded-lg border border-[#39ff88] bg-[#39ff88] text-neutral-950 px-3.5 py-2 text-sm font-semibold hover:bg-[#5fff9f] transition shadow-[0_0_16px_-4px_rgba(57,255,136,0.55)] hover:shadow-[0_0_22px_-2px_rgba(57,255,136,0.55)]"
        >
          [ sign in ]
        </button>
      </form>
    </main>
  );
}
