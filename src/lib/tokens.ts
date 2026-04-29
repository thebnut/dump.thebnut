import "server-only";
import crypto from "crypto";

const PREFIX = "dt_live_";

export type GeneratedToken = {
  plaintext: string; // shown to user once
  hash: string; // stored in DB
  prefix: string; // shown in UI; first 16 chars including the literal prefix
};

export function generateToken(): GeneratedToken {
  // 32 random bytes → 43 base64url chars (no padding)
  const random = crypto
    .randomBytes(32)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  const plaintext = `${PREFIX}${random}`;
  return {
    plaintext,
    hash: hashToken(plaintext),
    prefix: plaintext.slice(0, 16) + "…",
  };
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function looksLikeToken(input: string): boolean {
  return input.startsWith(PREFIX) && input.length > PREFIX.length + 20;
}
