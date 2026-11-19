/**
 * Anahtar başına token kovası. Her anahtar en fazla `capacity` ardışık
 * işlem yapabilir, sonra saniyede `refillPerSec` kadar yenilenir.
 * Spam yorumları bu sınırda durdurulur.
 */
interface Bucket {
  tokens: number;
  last: number;
}

export class KeyedRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  take(key: string): boolean {
    const t = this.now();
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: this.capacity, last: t };
      this.buckets.set(key, b);
    }
    const elapsedSec = Math.max(0, t - b.last) / 1000;
    b.tokens = Math.min(this.capacity, b.tokens + elapsedSec * this.refillPerSec);
    b.last = t;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  forget(key: string): void {
    this.buckets.delete(key);
  }

  clear(): void {
    this.buckets.clear();
  }
}
