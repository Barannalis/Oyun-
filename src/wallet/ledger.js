import { randomUUID } from 'node:crypto';
import { getCurrency } from '../core/money.js';
import { MODES } from '../core/domain.js';
import { InsufficientFundsError, ValidationError } from '../core/errors.js';

/**
 * Double-entry, multi-currency ledger.
 *
 * Invariants (enforced on every post):
 *  - every transaction's legs sum to zero per transaction;
 *  - a wallet is bound to one (mode, currency) and a transaction must match it;
 *  - user wallets may never go negative; system wallets may (they are counterparties);
 *  - an idempotency key posts at most once.
 */
export class Ledger {
  /** @param {import('../store/db.js').Database} db @param {{now: () => Date}} clock */
  constructor(db, clock) {
    this.db = db;
    this.clock = clock;
  }

  /** @returns {string} wallet id (created if missing) */
  ensureWallet(owner, mode, currency) {
    assertModeCurrency(mode, currency);
    this.db
      .prepare('INSERT OR IGNORE INTO wallets (id, owner_key, mode, currency, balance) VALUES (?, ?, ?, ?, 0)')
      .run(`wal_${randomUUID().replaceAll('-', '')}`, owner, mode, currency);
    return this.db
      .prepare('SELECT id FROM wallets WHERE owner_key = ? AND mode = ? AND currency = ?')
      .get(owner, mode, currency).id;
  }

  /** Balance in minor units. 0 when no wallet exists yet. */
  balance(owner, mode, currency) {
    const row = this.db
      .prepare('SELECT balance FROM wallets WHERE owner_key = ? AND mode = ? AND currency = ?')
      .get(owner, mode, currency);
    return row ? row.balance : 0;
  }

  /** All wallets for an owner. */
  wallets(owner) {
    return this.db
      .prepare('SELECT mode, currency, balance FROM wallets WHERE owner_key = ? ORDER BY mode, currency')
      .all(owner);
  }

  /**
   * Post one balanced transaction.
   * @param {{type: string, mode: string, currency: string,
   *          legs: Array<{owner: string, amount: number}>,
   *          idempotencyKey?: string|null, metadata?: object}} tx
   * @returns {{id: string|null, duplicate: boolean}} id is null when no leg is non-zero
   */
  post({ type, mode, currency, legs, idempotencyKey = null, metadata = {} }) {
    assertModeCurrency(mode, currency);
    if (!Array.isArray(legs) || legs.length === 0) throw new ValidationError('invalid_ledger_transaction');

    if (idempotencyKey) {
      const existing = this.db.prepare('SELECT id FROM transactions WHERE idempotency_key = ?').get(idempotencyKey);
      if (existing) return { id: existing.id, duplicate: true };
    }

    // Net the legs per owner, then drop zeros.
    const netByOwner = new Map();
    let sum = 0;
    for (const leg of legs) {
      if (!Number.isSafeInteger(leg.amount)) throw new ValidationError('invalid_ledger_amount');
      sum += leg.amount;
      netByOwner.set(leg.owner, (netByOwner.get(leg.owner) ?? 0) + leg.amount);
    }
    if (sum !== 0) throw new ValidationError('ledger_unbalanced', { sum });
    const nonZero = [...netByOwner.entries()].filter(([, amt]) => amt !== 0);
    if (nonZero.length === 0) return { id: null, duplicate: false };

    return this.db.transaction(() => {
      const plan = nonZero.map(([owner, amount]) => {
        const walletId = this.ensureWallet(owner, mode, currency);
        const row = this.db.prepare('SELECT balance FROM wallets WHERE id = ?').get(walletId);
        const next = row.balance + amount;
        if (!owner.startsWith('system:') && next < 0) throw new InsufficientFundsError();
        return { walletId, amount, next };
      });

      const id = `txn_${randomUUID().replaceAll('-', '')}`;
      this.db
        .prepare('INSERT INTO transactions (id, type, mode, currency, idempotency_key, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, type, mode, currency, idempotencyKey, JSON.stringify(metadata), this.clock.now().toISOString());
      for (const p of plan) {
        this.db.prepare('INSERT INTO entries (tx_id, wallet_id, amount) VALUES (?, ?, ?)').run(id, p.walletId, p.amount);
        this.db.prepare('UPDATE wallets SET balance = ? WHERE id = ?').run(p.next, p.walletId);
      }
      return { id, duplicate: false };
    });
  }

  /**
   * Sum of all balances for a (mode, currency). Must always be zero. Used by
   * the invariant test and the reporting job.
   */
  systemTotal(mode, currency) {
    return this.db
      .prepare('SELECT COALESCE(SUM(balance), 0) AS total FROM wallets WHERE mode = ? AND currency = ?')
      .get(mode, currency).total;
  }
}

function assertModeCurrency(mode, currency) {
  if (!MODES.includes(mode)) throw new ValidationError('invalid_mode');
  const c = getCurrency(currency);
  if (mode === 'virtual' && !c.virtual) throw new ValidationError('virtual_mode_requires_virtual_currency');
  if (mode === 'real' && c.virtual) throw new ValidationError('real_mode_forbids_virtual_currency');
}
