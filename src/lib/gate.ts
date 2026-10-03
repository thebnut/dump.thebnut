import "server-only";
import { cookies } from "next/headers";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { projectPasswords } from "./db/schema";
import { passwordsForProjectFull } from "./queries";
import { rateLimit, RL_AUTH } from "./rate-limit";

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

// Hard ceiling on a single unlock, however actively it's used. The sliding
// refresh keeps the original issue time, so a leaked or forgotten cookie
// can't live forever. Wallet entries carry the same ceiling (see below).
const GATE_ABSOLUTE_MAX_MS = 1000 * 60 * 60 * 24 * 90; // 90 days

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function gateCookieName(projectId: string): string {
  return `dt_g_${projectId}`;
}

function sign(value: string): string {
  return crypto.createHmac("sha256", getSecret()).update(value).digest("hex");
}

// The signature covers the password row's current hash, not just its id.
// Rotating a password (new hash, same row id) or deleting it therefore
// invalidates every cookie issued under the old one.
function tokenSig(
  projectId: string,
  passwordLabelId: string,
  issuedAt: number,
  passwordHash: string,
): string {
  return sign(`${projectId}.${passwordLabelId}.${issuedAt}.${passwordHash}`);
}

type GatePassword = { id: string; passwordHash: string };

export type GateSession = {
  passwordLabelId: string;
  passwordHash: string;
  label: string;
  issuedAt: number;
};

/**
 * Reads this project's gate cookie and checks it against the password row it
 * was issued for. Returns null when the cookie is missing, malformed, past
 * its 90-day ceiling, HMAC-invalid, or issued under a password that has
 * since been deleted or rotated (the HMAC covers the row's current hash).
 * Callers should redirect to the gate in any null case, exactly as they do
 * for "no cookie".
 *
 * The row lookup also keeps a stale id out of the access-log INSERT, where
 * `access_logs.password_label_id` is a FK to `project_passwords.id`.
 */
export async function readVerifiedGateCookie(
  projectId: string,
): Promise<GateSession | null> {
  const c = await cookies();
  const v = c.get(gateCookieName(projectId))?.value;
  if (!v) return null;

  const parts = v.split(".");
  if (parts.length !== 4) return null; // includes pre-revocation 3-part tokens
  const [pid, labelId, iatRaw, sig] = parts;
  if (pid !== projectId) return null;
  // Reject a malformed id before it reaches Postgres' uuid cast.
  if (!UUID_RE.test(labelId)) return null;
  const issuedAt = Number(iatRaw);
  if (!Number.isSafeInteger(issuedAt)) return null;
  if (Date.now() - issuedAt > GATE_ABSOLUTE_MAX_MS) return null;
  // timingSafeEqual throws on length mismatch; check the shape first so a
  // crafted cookie falls through to the gate instead of a 500.
  if (!/^[0-9a-f]{64}$/.test(sig)) return null;

  const [row] = await db
    .select()
    .from(projectPasswords)
    .where(
      and(
        eq(projectPasswords.id, labelId),
        eq(projectPasswords.projectId, projectId),
      ),
    )
    .limit(1);
  if (!row) return null;

  const expected = tokenSig(pid, labelId, issuedAt, row.passwordHash);
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }
  return {
    passwordLabelId: row.id,
    passwordHash: row.passwordHash,
    label: row.label,
    issuedAt,
  };
}

// `issuedAt` is passed through on a sliding refresh so the absolute ceiling
// counts from the original unlock; omit it for a fresh unlock.
export async function setGateCookie(
  projectId: string,
  password: GatePassword,
  issuedAt: number = Date.now(),
) {
  const c = await cookies();
  // Path is `/` (not `/p/`) so the cookie is sent on every request, including
  // sub-asset requests that arrive at the same handler. The cookie is already
  // scoped to a single project two ways: its name embeds the project id
  // (`dt_g_<projectId>`), and its value is HMAC-signed against the project id
  // (see `readVerifiedGateCookie`). Tightening the path to `/p/` is theoretically
  // sufficient, but in practice we saw cases where the browser didn't send
  // the cookie on child asset requests (`_shared.css`, `alpine.min.js`),
  // making the route hand back the gate HTML in place of the asset. A `/`
  // path eliminates the entire class of path-matching ambiguity.
  const sig = tokenSig(projectId, password.id, issuedAt, password.passwordHash);
  c.set(gateCookieName(projectId), `${projectId}.${password.id}.${issuedAt}.${sig}`, {
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
// Each entry is scoped to the owner of the prototype it unlocked, so a
// password only carries over to that same owner's other prototypes — two
// unrelated users who happen to pick the same password don't open each
// other's work.
//
// Matching another prototype's bcrypt hash requires the plaintext (hashes are
// per-row salted), so the wallet must store recoverable plaintext. We keep it
// out of any readable form by encrypting the cookie with AES-256-GCM keyed off
// AUTH_SECRET. Combined with httpOnly + secure, that's a reasonable bar for
// low-stakes prototype passwords; the GCM auth tag also rejects tampering.

const WALLET_COOKIE = "dt_pw";
const WALLET_MAX_ENTRIES = 10; // most-recent-first
// Encoded cookie value budget. Browsers cap a cookie at ~4KB including its
// name and attributes; stay well clear and leave room for the gate cookies.
const WALLET_MAX_COOKIE_BYTES = 2048;
// bcrypt ignores bytes past 72, so a longer "password" would match on its
// prefix alone. Don't remember those; they still work via the gate form.
const WALLET_MAX_PASSWORD_BYTES = 72;
// Upper bound on bcrypt comparisons per wallet unlock attempt (~50ms each at
// cost 10), so a full wallet against a project with many passwords can't turn
// one GET into seconds of CPU.
const WALLET_MAX_COMPARES = 12;

// Owner id, password, and when the visitor last typed it. The timestamp is
// inside the encrypted payload, so the server enforces the 90-day ceiling
// itself rather than trusting the browser to expire a copied cookie.
type WalletEntry = { o: string; p: string; t: number };

let walletKeyCache: Buffer | null = null;
function walletKey(): Buffer {
  if (!walletKeyCache) {
    walletKeyCache = crypto.scryptSync(getSecret(), "dt-wallet-v1", 32);
  }
  return walletKeyCache;
}

function encryptWallet(entries: WalletEntry[]): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", walletKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(entries), "utf8");
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64url"),
    tag.toString("base64url"),
    enc.toString("base64url"),
  ].join(".");
}

function decryptWallet(value: string): WalletEntry[] {
  const parts = value.split(".");
  if (parts.length !== 3) return [];
  try {
    const [iv, tag, enc] = parts.map((p) => Buffer.from(p, "base64url"));
    const decipher = crypto.createDecipheriv("aes-256-gcm", walletKey(), iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    const parsed: unknown = JSON.parse(dec.toString("utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is WalletEntry =>
        typeof e === "object" &&
        e !== null &&
        typeof e.o === "string" &&
        typeof e.p === "string" &&
        Number.isSafeInteger(e.t) &&
        Date.now() - e.t <= GATE_ABSOLUTE_MAX_MS,
    );
  } catch {
    // Tampered, truncated, or signed with an old/rotated AUTH_SECRET — treat
    // as an empty wallet rather than failing the request.
    return [];
  }
}

async function readWallet(): Promise<WalletEntry[]> {
  const c = await cookies();
  const v = c.get(WALLET_COOKIE)?.value;
  if (!v) return [];
  return decryptWallet(v);
}

async function writeWallet(entries: WalletEntry[]): Promise<void> {
  // Drop the oldest entries until the encrypted value fits the byte budget.
  let kept = entries.slice(0, WALLET_MAX_ENTRIES);
  let value = encryptWallet(kept);
  while (kept.length > 1 && value.length > WALLET_MAX_COOKIE_BYTES) {
    kept = kept.slice(0, -1);
    value = encryptWallet(kept);
  }
  if (value.length > WALLET_MAX_COOKIE_BYTES) return;
  const c = await cookies();
  c.set(WALLET_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: `/`,
    maxAge: GATE_MAX_AGE,
  });
}

// Remember a password the visitor just typed on one of `ownerId`'s
// prototypes. De-duplicates and keeps the most recently used entries first.
export async function addPasswordToWallet(
  ownerId: string,
  password: string,
): Promise<void> {
  if (!password) return;
  if (Buffer.byteLength(password, "utf8") > WALLET_MAX_PASSWORD_BYTES) return;
  await rememberEntry({ o: ownerId, p: password, t: Date.now() });
}

async function rememberEntry(entry: WalletEntry): Promise<void> {
  const existing = await readWallet();
  await writeWallet([
    entry,
    ...existing.filter((e) => !(e.o === entry.o && e.p === entry.p)),
  ]);
}

// Try the visitor's remembered passwords for this prototype's owner against
// its stored hashes. Returns the matching password row plus the time the
// password was originally typed (use it as the gate cookie's issue time, so
// a wallet unlock can't extend the 90-day ceiling), or null. Lets a
// prototype auto-unlock when it shares a password with one the visitor has
// already unlocked, without a re-prompt.
//
// Attempts are rate-limited per client IP (across projects, since walking
// many projects is the abuse pattern), like the gate form. A limited
// visitor just sees the gate.
export async function tryWalletUnlock(
  project: { id: string; ownerId: string },
  ip: string,
): Promise<{
  password: GatePassword & { label: string };
  issuedAt: number;
} | null> {
  const candidates = (await readWallet()).filter(
    (e) => e.o === project.ownerId,
  );
  if (candidates.length === 0) return null;
  if (!rateLimit(`wallet:${ip}`, RL_AUTH).allowed) return null;
  const rows = await passwordsForProjectFull(project.id);
  let compares = 0;
  for (const candidate of candidates) {
    for (const row of rows) {
      if (++compares > WALLET_MAX_COMPARES) return null;
      if (await bcrypt.compare(candidate.p, row.passwordHash)) {
        // Bump this entry to the front and refresh the wallet cookie's
        // expiry, keeping its original timestamp.
        await rememberEntry(candidate);
        return { password: row, issuedAt: candidate.t };
      }
    }
  }
  return null;
}
