import "server-only";
import { cookies } from "next/headers";
import crypto from "crypto";

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
