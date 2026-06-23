import "server-only";
import crypto from "crypto";
import bcrypt from "bcryptjs";

// Single source of truth for the bcrypt cost factor used across the app.
const BCRYPT_ROUNDS = 10;

// Unambiguous alphabet: no 0/O, 1/l/I — so an admin can read a generated
// password off the screen and dictate/retype it without transcription errors.
const ALPHABET =
  "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * Generate a strong, human-readable one-time password.
 *
 * 16 chars from a 56-char alphabet ≈ 93 bits of entropy. Uses rejection
 * sampling so every character is uniformly distributed (no modulo bias).
 */
export function generatePassword(length = 16): string {
  // Largest multiple of the alphabet size that fits in a byte; bytes at or
  // above this are discarded to keep the distribution uniform.
  const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  let out = "";
  while (out.length < length) {
    const bytes = crypto.randomBytes(length);
    for (let i = 0; i < bytes.length && out.length < length; i++) {
      if (bytes[i] < limit) out += ALPHABET[bytes[i] % ALPHABET.length];
    }
  }
  return out;
}

/** Hash a plaintext password with the app-wide bcrypt cost factor. */
export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}
