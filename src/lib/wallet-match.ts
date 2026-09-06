import { createHash } from "node:crypto";
export type WalletEntry = { ownerId: string; password: string };
export type WalletPassword = { id: string; label: string; passwordHash: string };

// Automatic unlock is opportunistic: five recent entries and 25 comparisons.
// A budget exhaustion falls back to the explicit gate, which checks ALL current
// password labels. It is never cached as a proven miss. Keys contain digests.
export function createWalletMatcher(compare: (password: string, hash: string) => Promise<boolean>) {
  const misses = new Map<string, number>();
  const inFlight = new Map<string, Promise<WalletPassword | null>>();
  return async (projectId: string, ownerId: string, wallet: WalletEntry[], hashes: WalletPassword[], now = Date.now()): Promise<WalletPassword | null> => {
    const candidates = wallet.filter(entry => entry.ownerId === ownerId).slice(0, 5);
    if (!candidates.length || !hashes.length) return null;
    const key = createHash("sha256").update(JSON.stringify([projectId, ownerId, candidates, hashes])).digest("hex");
    if ((misses.get(key) ?? 0) > now) return null;
    const pending = inFlight.get(key);
    if (pending) return pending;
    if (inFlight.size >= 500) return null;
    const lookup = (async () => {
      let comparisons = 0;
      for (const candidate of candidates) {
        for (const row of hashes) {
          if (++comparisons > 25) return null;
          if (await compare(candidate.password, row.passwordHash)) return row;
        }
      }
      if (misses.size >= 500) misses.delete(misses.keys().next().value!);
      misses.set(key, now + 30000);
      return null;
    })();
    inFlight.set(key, lookup);
    try { return await lookup; } finally { inFlight.delete(key); }
  };
}
