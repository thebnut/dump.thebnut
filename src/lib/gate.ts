import "server-only";
import { cookies } from "next/headers";
import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { projectPasswords } from "./db/schema";

const SECRET = process.env.AUTH_SECRET || "dev-fallback-secret";

export function gateCookieName(projectId: string): string {
  return `dt_g_${projectId}`;
}

function sign(value: string): string {
  return crypto.createHmac("sha256", SECRET).update(value).digest("hex");
}

export function makeGateToken(projectId: string, passwordLabelId: string): string {
  const payload = `${projectId}.${passwordLabelId}`;
  const sig = sign(payload);
  return `${payload}.${sig}`;
}

export function verifyGateToken(
  token: string,
  projectId: string,
): { passwordLabelId: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [pid, labelId, sig] = parts;
  if (pid !== projectId) return null;
  const expected = sign(`${pid}.${labelId}`);
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
    return null;
  return { passwordLabelId: labelId };
}

export async function readGateCookie(projectId: string) {
  const c = await cookies();
  const v = c.get(gateCookieName(projectId))?.value;
  if (!v) return null;
  return verifyGateToken(v, projectId);
}

/**
 * Like readGateCookie, but also checks that the cookie's
 * `password_label_id` still references a live row in `project_passwords`
 * and returns the password's current label for access-log writes.
 *
 * Why this exists: HMAC verification only proves the cookie was minted by
 * us against this project — it can't tell whether the password the user
 * originally authed against has since been rotated or removed. Treating
 * a now-orphaned cookie as valid would (a) let a user past the gate with
 * a revoked password and (b) crash the route handler on the next access-
 * log INSERT, since `access_logs.password_label_id` is a FK to
 * `project_passwords.id` (the FK fires on insert even though the schema
 * has ON DELETE SET NULL — that only nulls existing rows).
 *
 * Returns null when the cookie is missing, malformed, HMAC-invalid, OR
 * references a deleted password. Callers should redirect to the gate in
 * any null case, exactly as they already do for "no cookie".
 */
export async function readVerifiedGateCookie(
  projectId: string,
): Promise<{ passwordLabelId: string; label: string } | null> {
  const verified = await readGateCookie(projectId);
  if (!verified) return null;
  const [row] = await db
    .select({ id: projectPasswords.id, label: projectPasswords.label })
    .from(projectPasswords)
    .where(
      and(
        eq(projectPasswords.id, verified.passwordLabelId),
        eq(projectPasswords.projectId, projectId),
      ),
    )
    .limit(1);
  if (!row) return null;
  return { passwordLabelId: verified.passwordLabelId, label: row.label };
}

export async function setGateCookie(projectId: string, passwordLabelId: string) {
  const c = await cookies();
  // Path is `/` (not `/p/`) so the cookie is sent on every request, including
  // sub-asset requests that arrive at the same handler. The cookie is already
  // scoped to a single project two ways: its name embeds the project id
  // (`dt_g_<projectId>`), and its value is HMAC-signed against the project id
  // (see `verifyGateToken`). Tightening the path to `/p/` is theoretically
  // sufficient, but in practice we saw cases where the browser didn't send
  // the cookie on child asset requests (`_shared.css`, `alpine.min.js`),
  // making the route hand back the gate HTML in place of the asset. A `/`
  // path eliminates the entire class of path-matching ambiguity.
  c.set(gateCookieName(projectId), makeGateToken(projectId, passwordLabelId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: `/`,
    maxAge: 60 * 60 * 24, // 24h
  });
}
