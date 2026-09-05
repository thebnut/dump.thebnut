import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { oauthCodes, oauthTokens } from "@/lib/db/schema";
import { and, eq, gt, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default async function ConnectionsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=%2Foauth%2Fconnections");
  const grants = await db.select({ scope: oauthTokens.scope }).from(oauthTokens).where(and(eq(oauthTokens.userId, session.user.id), isNull(oauthTokens.revokedAt), gt(oauthTokens.refreshExpiresAt, new Date())));
  async function revoke() {
    "use server";
    const current = await auth();
    if (!current?.user?.id) redirect("/login");
    await db.transaction(async tx => {
      await tx.update(oauthTokens).set({ revokedAt: new Date() }).where(eq(oauthTokens.userId, current.user.id));
      await tx.delete(oauthCodes).where(eq(oauthCodes.userId, current.user.id));
    });
    redirect("/oauth/connections");
  }
  return <main className="max-w-lg mx-auto p-8 space-y-5"><h1 className="text-2xl">Connected apps</h1><p>ChatGPT: {grants.length ? "connected" : "disconnected"}</p>{grants.length > 0 && <form action={revoke}><button className="border rounded px-4 py-2">Disconnect all ChatGPT sessions</button></form>}<a href="/" className="underline">Back to your dump</a></main>;
}
