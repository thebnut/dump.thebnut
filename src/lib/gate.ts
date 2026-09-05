import "server-only";
import { cookies } from "next/headers";
import crypto from "crypto";

const SECRET = process.env.AUTH_SECRET || "dev-fallback-secret";

// How long an unlocked prototype stays unlocked. Refreshed on every
// authenticated request (sliding window) so an actively-used prototype
// effectively never re-prompts.
const GATE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

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
    maxAge: GATE_MAX_AGE,
  });
}

// ----------------------------------------------------------------------------
// Password wallet
// ----------------------------------------------------------------------------
// The per-project gate cookie above only unlocks ONE prototype. People who
// view several prototypes that share a password were re-typing it for each
// one. The wallet fixes that: every password the visitor successfully enters
// is remembered, and when they open a not-yet-unlocked prototype we silently
// try the remembered passwords against it before showing the gate.
//
// Matching another prototype's bcrypt hash requires the plaintext (hashes are
// per-row salted), so the wallet must store recoverable plaintext. We keep it
// out of any readable form by encrypting the cookie with AES-256-GCM keyed off
// AUTH_SECRET. Combined with httpOnly + secure, that's a reasonable bar for
// low-stakes prototype passwords; the GCM auth tag also rejects tampering.

const WALLET_COOKIE = "dt_pw";
const WALLET_MAX_ENTRIES = 25; // bound cookie size; most-recent-first

let walletKeyCache: Buffer | null = null;
function walletKey(): Buffer {
  if (!walletKeyCache) {
    walletKeyCache = crypto.scryptSync(SECRET, "dt-wallet-v1", 32);
  }
  return walletKeyCache;
}

export function encryptWallet(passwords: string[]): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", walletKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(passwords), "utf8");
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64url"),
    tag.toString("base64url"),
    enc.toString("base64url"),
  ].join(".");
}

export function decryptWallet(value: string): string[] {
  const parts = value.split(".");
  if (parts.length !== 3) return [];
  try {
    const [iv, tag, enc] = parts.map((p) => Buffer.from(p, "base64url"));
    const decipher = crypto.createDecipheriv("aes-256-gcm", walletKey(), iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    const parsed: unknown = JSON.parse(dec.toString("utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is string => typeof p === "string");
  } catch {
    // Tampered, truncated, or signed with an old/rotated AUTH_SECRET — treat
    // as an empty wallet rather than failing the request.
    return [];
  }
}

export async function readWallet(): Promise<string[]> {
  const c = await cookies();
  const v = c.get(WALLET_COOKIE)?.value;
  if (!v) return [];
  return decryptWallet(v);
}

// Remember a password the visitor just used. De-duplicates and keeps the most
// recently used entries first, capped at WALLET_MAX_ENTRIES.
export async function addPasswordToWallet(password: string): Promise<void> {
  if (!password) return;
  const existing = await readWallet();
  const next = [password, ...existing.filter((p) => p !== password)].slice(
    0,
    WALLET_MAX_ENTRIES,
  );
  const c = await cookies();
  c.set(WALLET_COOKIE, encryptWallet(next), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: `/`,
    maxAge: GATE_MAX_AGE,
  });
}
