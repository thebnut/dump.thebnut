import OAuth2Server from "@node-oauth/oauth2-server";
import { auth } from "@/lib/auth";
import { oauth } from "@/lib/oauth-db";
import { CALLBACK, ISSUER, validateAuthorization } from "@/lib/oauth-policy";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const query: Record<string, string> = {};
  let scopes: string[];
  try {
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value !== "string" || value.length > 4096) throw new Error("Invalid parameter");
      query[key] = value;
    }
    scopes = validateAuthorization(query);
  } catch {
    return <main className="p-8 max-w-lg mx-auto"><h1>Connection request is invalid</h1><p>Return to ChatGPT and start the connection again.</p></main>;
  }
  const session = await auth();
  if (!session?.user?.id) redirect(`/login?callbackUrl=${encodeURIComponent('/oauth/authorize?' + new URLSearchParams(query))}`);
  if (session.user.id !== process.env.TOOLKIT_OWNER_ID) return <main className="p-8 max-w-lg mx-auto"><h1>This toolkit is private to its owner</h1><p>Sign in with the owner&apos;s dump account to connect.</p></main>;

  async function decide(form: FormData) {
    "use server";
    const current = await auth();
    if (!current?.user?.id || current.user.id !== session!.user.id || current.user.id !== process.env.TOOLKIT_OWNER_ID) redirect("/login");
    validateAuthorization(query);
    const destination = new URL(CALLBACK);
    destination.searchParams.set("state", query.state);
    destination.searchParams.set("iss", ISSUER);
    if (form.get("decision") !== "allow") {
      destination.searchParams.set("error", "access_denied");
    } else {
      const response = new OAuth2Server.Response();
      const code = await oauth.authorize(new OAuth2Server.Request({ method: "GET", headers: {}, query: { ...query, allowed: "true" } }), response, { authenticateHandler: { handle: async () => ({ id: current.user.id }) } });
      destination.searchParams.set("code", code.authorizationCode);
    }
    redirect(destination.toString());
  }

  return <main className="min-h-dvh grid place-items-center p-6 bg-neutral-950 text-neutral-100">
    <section className="max-w-lg w-full border border-neutral-700 rounded-xl p-7 space-y-5">
      <h1 className="text-2xl font-semibold">Connect ChatGPT to Brett Toolkit</h1>
      <p>Signed in as {session.user.email}.</p>
      <ul className="list-disc pl-5 space-y-2">
        {scopes.includes("projects:read") && <li>Read the names, settings and file lists of projects you own.</li>}
        {scopes.includes("projects:write") && <li>Create public static pages and replace files in projects you own. Existing passwords and expiry settings are preserved.</li>}
        {scopes.includes("discord:read") && <li>Read and search messages, thread history and attachment links in your configured Discord servers using Baz&apos;s existing bot access. This does not include personal DMs or permission to send Discord messages.</li>}
      </ul>
      <p className="text-neutral-400 text-sm">This connection cannot delete projects, manage users or change passwords. You can disconnect it from your Connected apps page.</p>
      <form action={decide} className="flex flex-wrap gap-3">
        <button name="decision" value="allow" className="rounded-lg px-5 py-2 bg-[#39ff88] text-neutral-950 font-semibold">Connect</button>
        <button name="decision" value="deny" className="rounded-lg px-5 py-2 border border-neutral-600">Cancel</button>
      </form>
    </section>
  </main>;
}
