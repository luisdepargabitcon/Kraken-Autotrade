export interface AuthV2RateLimitResult { allowed: boolean; retryAfterSec?: number }

export class AuthV2RateLimiter {
  private buckets = new Map<string, { count: number; resetAt: number; lockedUntil?: number }>();
  private timer?: NodeJS.Timeout;
  constructor(private windowMs = 60_000, private max = 30, private lockoutMs = 10 * 60_000, private lockAfter = 8) {
    this.timer = setInterval(() => this.prune(), this.windowMs);
    this.timer.unref?.();
  }
  check(key: string, now = Date.now()): AuthV2RateLimitResult {
    this.prune(now);
    const b = this.buckets.get(key);
    if (!b) return { allowed: true };
    if (b.lockedUntil && b.lockedUntil > now) return { allowed: false, retryAfterSec: Math.ceil((b.lockedUntil - now) / 1000) };
    return { allowed: true };
  }
  recordSuccess(key: string): void { this.buckets.delete(key); }
  recordFailure(key: string, now = Date.now()): AuthV2RateLimitResult {
    this.prune(now);
    const b = this.buckets.get(key) || { count: 0, resetAt: now + this.windowMs };
    if (b.resetAt <= now) { b.count = 0; b.resetAt = now + this.windowMs; delete b.lockedUntil; }
    b.count += 1;
    if (b.count >= this.lockAfter) { b.lockedUntil = now + this.lockoutMs; b.count = 0; }
    this.buckets.set(key, b);
    return this.check(key, now);
  }
  hit(key: string, now = Date.now()): AuthV2RateLimitResult {
    this.prune(now);
    const b = this.buckets.get(key) || { count: 0, resetAt: now + this.windowMs };
    if (b.resetAt <= now) { b.count = 0; b.resetAt = now + this.windowMs; }
    b.count += 1;
    this.buckets.set(key, b);
    if (b.lockedUntil && b.lockedUntil > now) return { allowed: false, retryAfterSec: Math.ceil((b.lockedUntil - now) / 1000) };
    if (b.count > this.max) return { allowed: false, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
    return { allowed: true };
  }
  private prune(now = Date.now()): void {
    for (const [k,b] of this.buckets) if ((!b.lockedUntil || b.lockedUntil <= now) && b.resetAt <= now) this.buckets.delete(k);
  }
}
