import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { GiftEntry, GiftTier } from '@ttl/game-core';

export const GIFT_TIERS: readonly GiftTier[] = ['small', 'medium', 'big', 'special'];
const MAX_GIFT_NAME = 64;

/**
 * Yalnızca ilk kurulumda eklenen örnek eşlemeler. Bunlar yer tutucudur, yayıncı
 * kendi TikTok hediye adlarını panelden eklemeli veya değiştirmelidir.
 */
const SEED_GIFTS: GiftEntry[] = [
  { name: 'Gül', tier: 'small' },
  { name: 'Kalp', tier: 'medium' },
  { name: 'Aslan', tier: 'big' },
  { name: 'Evren', tier: 'special' },
];

export function isTier(v: unknown): v is GiftTier {
  return typeof v === 'string' && (GIFT_TIERS as readonly string[]).includes(v);
}

/** Hediye adının karşılaştırma anahtarı. Büyük/küçük harf ve fazla boşluk yok sayılır (tr-TR). */
export function giftKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr-TR');
}

/** Hediye eşlemelerini SQLite'ta saklar. ':memory:' geçici kullanım içindir. */
export class GiftStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('CREATE TABLE IF NOT EXISTS gifts (key TEXT PRIMARY KEY, name TEXT NOT NULL, tier TEXT NOT NULL)');
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM gifts').get() as { c: number };
    if (row.c === 0) for (const g of SEED_GIFTS) this.set(g.name, g.tier);
  }

  list(): GiftEntry[] {
    const rows = this.db.prepare('SELECT name, tier FROM gifts ORDER BY name COLLATE NOCASE').all() as Array<{
      name: string;
      tier: string;
    }>;
    return rows.map((r) => ({ name: r.name, tier: r.tier as GiftTier }));
  }

  resolve(name: string): GiftTier | undefined {
    const row = this.db.prepare('SELECT tier FROM gifts WHERE key = ?').get(giftKey(name)) as
      | { tier: string }
      | undefined;
    return row ? (row.tier as GiftTier) : undefined;
  }

  /** Eşleme ekler veya günceller. Geçersiz ad ya da kademe reddedilir. */
  set(name: string, tier: GiftTier): boolean {
    const clean = name.trim().replace(/\s+/g, ' ');
    if (clean.length === 0 || clean.length > MAX_GIFT_NAME || !isTier(tier)) return false;
    this.db
      .prepare(
        'INSERT INTO gifts (key, name, tier) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET name = excluded.name, tier = excluded.tier',
      )
      .run(giftKey(clean), clean, tier);
    return true;
  }

  remove(name: string): boolean {
    const result = this.db.prepare('DELETE FROM gifts WHERE key = ?').run(giftKey(name));
    return Number(result.changes) > 0;
  }

  close(): void {
    this.db.close();
  }
}
