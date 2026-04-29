import { redirect } from "next/navigation";
import { signIn, auth } from "@/lib/auth";
import { AuthError } from "next-auth";
import { Logo } from "@/components/Logo";

type Props = {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
};

export default async function LoginPage({ searchParams }: Props) {
  const session = await auth();
  if (session?.user) redirect("/");

  const sp = await searchParams;
  const error = sp.error;

  async function login(formData: FormData) {
    "use server";
    try {
      await signIn("credentials", {
        email: String(formData.get("email") ?? ""),
        password: String(formData.get("password") ?? ""),
        redirectTo: "/",
      });
    } catch (e) {
      if (e instanceof AuthError) {
        redirect(`/login?error=invalid`);
      }
      throw e;
    }
  }

  return (
    <main className="min-h-dvh grid place-items-center bg-neutral-950 text-neutral-100 p-6">
      <form
        action={login}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-neutral-800 bg-neutral-900/50 p-8"
      >
        <div className="space-y-1">
          <Logo size="md" />
          <p className="text-sm text-neutral-400">Sign in to view your dump.</p>
        </div>

        <div className="space-y-2">
          <label htmlFor="email" className="text-xs text-neutral-400">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-500"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="password" className="text-xs text-neutral-400">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-500"
          />
        </div>

        {error ? (
          <p className="text-xs text-red-400">Invalid email or password.</p>
        ) : null}

        <button
          type="submit"
          className="w-full rounded-lg bg-white text-neutral-900 px-3 py-2 text-sm font-medium hover:bg-neutral-200 transition"
        >
          Sign in
        </button>
      </form>
    </main>
  );
}
