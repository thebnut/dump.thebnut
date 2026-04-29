import "server-only";

// Token-bucket rate limiter. In-memory only — fine for a single Vercel
// serverless region; resets on cold start. If we ever need cross-instance
// limits, swap the Map for Upstash Redis with the same interface.

type Bucket = { tokens: number; updatedAt: number };

type Config = {
  capacity: number; // max tokens
  refillPerSec: number; // tokens added per second
};

const buckets = new Map<string, Bucket>();

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
};

export function rateLimit(key: string, cfg: Config): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key) ?? {
    tokens: cfg.capacity,
    updatedAt: now,
  };
  const elapsedSec = (now - bucket.updatedAt) / 1000;
  bucket.tokens = Math.min(
    cfg.capacity,
    bucket.tokens + elapsedSec * cfg.refillPerSec,
  );
  bucket.updatedAt = now;

  if (bucket.tokens < 1) {
    const retryAfterSec = Math.ceil((1 - bucket.tokens) / cfg.refillPerSec);
    buckets.set(key, bucket);
    return { allowed: false, remaining: 0, retryAfterSec };
  }
  bucket.tokens -= 1;
  buckets.set(key, bucket);
  return {
    allowed: true,
    remaining: Math.floor(bucket.tokens),
    retryAfterSec: 0,
  };
}

// Cheap default scopes — adjust per-route as needed.
// refillPerSec = capacity / 60 (the "per minute" intent).
export const RL_DEFAULT: Config = { capacity: 60, refillPerSec: 1 }; // 60/min
export const RL_UPLOAD: Config = { capacity: 10, refillPerSec: 10 / 60 }; // 10/min
