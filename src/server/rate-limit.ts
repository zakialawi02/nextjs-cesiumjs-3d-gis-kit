/**
 * Fixed-window rate limiter (port of Laravel's RateLimiter / throttle middleware).
 *
 * State lives in process memory, shared across requests through globalThis. That is enough for
 * a single `next start` instance; run several instances behind a load balancer and you need a
 * shared store (Redis, Postgres) instead.
 */
type Bucket = { hits: number; resetAt: number };

const globalForLimiter = globalThis as typeof globalThis & { __rateLimitBuckets?: Map<string, Bucket> };
const buckets = (globalForLimiter.__rateLimitBuckets ??= new Map<string, Bucket>());

function sweep(now: number) {
  if (buckets.size < 5000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function current(key: string, now: number): Bucket | undefined {
  const bucket = buckets.get(key);
  if (bucket && bucket.resetAt <= now) {
    buckets.delete(key);
    return undefined;
  }
  return bucket;
}

export const rateLimiter = {
  /** Records one hit and returns the number of hits in the current window. */
  hit(key: string, decaySeconds = 60): number {
    const now = Date.now();
    sweep(now);
    const bucket = current(key, now) ?? { hits: 0, resetAt: now + decaySeconds * 1000 };
    bucket.hits += 1;
    buckets.set(key, bucket);
    return bucket.hits;
  },

  tooManyAttempts(key: string, maxAttempts: number): boolean {
    return (current(key, Date.now())?.hits ?? 0) >= maxAttempts;
  },

  /** Seconds until the key's window resets (0 when it has no hits). */
  availableIn(key: string): number {
    const bucket = current(key, Date.now());
    return bucket ? Math.max(1, Math.ceil((bucket.resetAt - Date.now()) / 1000)) : 0;
  },

  clear(key: string): void {
    buckets.delete(key);
  },

  /**
   * Hits the key and reports whether the request is allowed (max requests per decay window).
   */
  attempt(key: string, maxAttempts: number, decaySeconds = 60): { allowed: boolean; retryAfter: number } {
    if (this.tooManyAttempts(key, maxAttempts)) {
      return { allowed: false, retryAfter: this.availableIn(key) };
    }
    this.hit(key, decaySeconds);
    return { allowed: true, retryAfter: 0 };
  },
};

/** Named per-minute limits (Laravel: AppServiceProvider + throttle:x,1 route middleware). */
export const RATE_LIMITS = {
  "upload-start": 20,
  "upload-chunks": 240,
  "upload-status": 120,
  login: 20,
  "login-identifier": 5,
  "forgot-password": 6,
  "reset-password": 6,
  "profile-password": 6,
} as const;

export type RateLimitName = keyof typeof RATE_LIMITS;

/**
 * Applies a named per-minute limit to `subject` (a user id, or the client IP for guests).
 */
export function limitPerMinute(name: RateLimitName, subject: string) {
  return rateLimiter.attempt(`${name}:${subject}`, RATE_LIMITS[name], 60);
}
