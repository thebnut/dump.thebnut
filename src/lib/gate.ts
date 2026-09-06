import "server-only";
import { cookies } from "next/headers";
import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { projectPasswords } from "./db/schema";
import type { WalletEntry } from "./wallet-match";

// HMAC key for the gate cookie. Must come from env in any non-dev
// environment — falling back to a hardcoded string in production (or
// preview) would let anyone with the public repo mint valid gate cookies
// for any project.
//
// Resolved lazily on first use rather than at module load: `next build`
// loads server modules during "collect page data" without runtime env
// vars present, so a module-load throw would break the build itself.
// First call from a request runs in `phase-production-server`, where
// AUTH_SECRET is set — anywhere it isn't, we fail loudly at that point.
let cachedSecret: string | undefined;
function getSecret(): string {
  if (cachedSecret !== undefined) return cachedSecret;
  const env = process.env.AUTH_SECRET;
  if (env) {
    cachedSecret = env;
    return env;
  }
  if (process.env.NODE_ENV !== "development") {
    throw new Error(
      "AUTH_SECRET must be set outside of local development. Gate cookies " +
        "are HMAC-signed with this value — a hardcoded fallback would let " +
        "anyone with the public repo forge valid sessions.",
    );
  }
  cachedSecret = "dev-fallback-secret";
  return cachedSecret;
}

// How long an unlocked prototype stays unlocked. Refreshed on every
// authenticated request (sliding window) so an actively-used prototype
// effectively never re-prompts.
const GATE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export function gateCookieName(projectId: string): string {
  return `dt_g_${projectId}`;
}

function sign(value: string): string {
  return crypto.createHmac("sha256", getSecret()).update(value).digest("hex");
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
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch — a crafted cookie of any
  // shape would otherwise propagate to the route handler as a 500. Treat
  // length-mismatched signatures as plain "invalid" so the gate-redirect
  // path runs instead.
  if (sigBuf.length !== expBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
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
const WALLET_MAX_BYTES = 3500;

let walletKeyCache: Buffer | null = null;
function walletKey(): Buffer {
  if (!walletKeyCache) {
    walletKeyCache = crypto.scryptSync(getSecret(), "dt-wallet-v1", 32);
  }
  return walletKeyCache;
}

export function encryptWallet(passwords: WalletEntry[]): string {
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

export function decryptWallet(value: string): WalletEntry[] {
  if (Buffer.byteLength(value) > WALLET_MAX_BYTES) return [];
  const parts = value.split(".");
  if (parts.length !== 3) return [];
  try {
    const [iv, tag, enc] = parts.map((p) => Buffer.from(p, "base64url"));
    const decipher = crypto.createDecipheriv("aes-256-gcm", walletKey(), iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    const parsed: unknown = JSON.parse(dec.toString("utf8"));
    if (!Array.isArray(parsed)) return [];
    // Legacy unscoped string entries are not reused across owners.
    return parsed.filter((p): p is WalletEntry => !!p && typeof p === "object" && typeof p.ownerId === "string" && typeof p.password === "string").slice(0, WALLET_MAX_ENTRIES);
  } catch {
    // Tampered, truncated, or signed with an old/rotated AUTH_SECRET — treat
    // as an empty wallet rather than failing the request.
    return [];
  }
}

export async function readWallet(): Promise<WalletEntry[]> {
  const c = await cookies();
  const v = c.get(WALLET_COOKIE)?.value;
  if (!v) return [];
  return decryptWallet(v);
}

// Remember a password the visitor just used. De-duplicates and keeps the most
// recently used entries first, capped at WALLET_MAX_ENTRIES.
export async function addPasswordToWallet(password: string, ownerId: string): Promise<void> {
  if (!password || !ownerId) return;
  if (Buffer.byteLength(encryptWallet([{ ownerId, password }])) > WALLET_MAX_BYTES) return;
  const existing = await readWallet();
  const next = [{ ownerId, password }, ...existing.filter((p) => p.ownerId !== ownerId || p.password !== password)].slice(
    0,
    WALLET_MAX_ENTRIES,
  );
  let encrypted = encryptWallet(next);
  while (Buffer.byteLength(encrypted) > WALLET_MAX_BYTES && next.length) {
    next.pop(); encrypted = encryptWallet(next);
  }
  const c = await cookies();
  c.set(WALLET_COOKIE, encrypted, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: `/`,
    maxAge: GATE_MAX_AGE,
  });
}
