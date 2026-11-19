import { ValidationError } from '../core/errors.js';

const DAY_MS = 86400000;
const HOUR_MS = 3600000;

/**
 * Responsible-gambling controls.
 *  - Daily deposit limits: lowering takes effect immediately; raising takes
 *    effect only after the jurisdiction's cooling-off period (so impulsive
 *    increases cannot bypass a limit at once).
 *  - Self-exclusion: once set it can be extended, never shortened, and must
 *    last at least the jurisdiction's minimum period.
 *  - Jurisdiction caps: a player limit can never exceed the profile maximum.
 */
export class ResponsibleGambling {
  /**
   * @param {{db: import('../store/db.js').Database, clock: {now: () => Date}, jurisdictions: Map<string, object>}} deps
   */
  constructor({ db, clock, jurisdictions }) {
    this.db = db;
    this.clock = clock;
    this.jurisdictions = jurisdictions;
  }

  /** Limit in force now, or null when the player has none. */
  effectiveDailyDeposit(userId, currency, now = this.clock.now()) {
    const row = this.db
      .prepare('SELECT daily_deposit, pending_daily_deposit, pending_effective_at FROM user_limits WHERE user_id = ? AND currency = ?')
      .get(userId, currency);
    if (!row) return null;
    if (row.pending_effective_at && now.getTime() >= Date.parse(row.pending_effective_at)) {
      return row.pending_daily_deposit;
    }
    return row.daily_deposit;
  }

  /** Apply a due pending increase so the stored state is current before a write. */
  materialize(userId, currency, now) {
    this.db
      .prepare(`UPDATE user_limits SET daily_deposit = pending_daily_deposit, pending_daily_deposit = NULL, pending_effective_at = NULL
                WHERE user_id = ? AND currency = ? AND pending_effective_at IS NOT NULL AND ? >= pending_effective_at`)
      .run(userId, currency, now.toISOString());
  }

  /**
   * @param {{userId: string, profile: object, currency: string, amountMinor: number|null}} input
   *        amountMinor null means "remove the limit" (which is an increase).
   */
  setDailyDepositLimit({ userId, profile, currency, amountMinor }) {
    const now = this.clock.now();
    const rg = profile.real_money.responsible_gambling;
    const cap = rg.max_daily_deposit[currency];
    if (cap !== undefined) {
      if (amountMinor === null || amountMinor > cap) throw new ValidationError('limit_above_cap', { max: cap });
    }
    if (amountMinor !== null && (!Number.isSafeInteger(amountMinor) || amountMinor <= 0)) {
      throw new ValidationError('invalid_amount');
    }

    return this.db.transaction(() => {
      this.materialize(userId, currency, now);
      this.db
        .prepare('INSERT OR IGNORE INTO user_limits (user_id, currency) VALUES (?, ?)')
        .run(userId, currency);
      const current = this.db
        .prepare('SELECT daily_deposit FROM user_limits WHERE user_id = ? AND currency = ?')
        .get(userId, currency).daily_deposit;

      const isIncrease = current !== null && (amountMinor === null || amountMinor > current);
      if (isIncrease) {
        const effectiveAt = new Date(now.getTime() + rg.cooling_off_hours * HOUR_MS).toISOString();
        this.db
          .prepare('UPDATE user_limits SET pending_daily_deposit = ?, pending_effective_at = ? WHERE user_id = ? AND currency = ?')
          .run(amountMinor, effectiveAt, userId, currency);
        return { effective: current, pending: amountMinor, pendingEffectiveAt: effectiveAt };
      }
      this.db
        .prepare('UPDATE user_limits SET daily_deposit = ?, pending_daily_deposit = NULL, pending_effective_at = NULL WHERE user_id = ? AND currency = ?')
        .run(amountMinor, userId, currency);
      return { effective: amountMinor, pending: null, pendingEffectiveAt: null };
    });
  }

  /**
   * @param {{userId: string, profile: object, currentExclusionUntil: string|null, untilIso: string}} input
   */
  selfExclude({ userId, profile, currentExclusionUntil, untilIso }) {
    const now = this.clock.now();
    const until = Date.parse(untilIso);
    if (Number.isNaN(until)) throw new ValidationError('invalid_input', { field: 'until' });
    const minDays = profile.real_money.responsible_gambling.self_exclusion_min_days;
    if (until - now.getTime() < minDays * DAY_MS) throw new ValidationError('self_exclusion_too_short', { minDays });
    if (currentExclusionUntil && Date.parse(currentExclusionUntil) > until) throw new ValidationError('self_exclusion_shorter');
    const iso = new Date(until).toISOString();
    this.db.prepare('UPDATE users SET self_excluded_until = ? WHERE id = ?').run(iso, userId);
    return iso;
  }
}

export function isSelfExcluded(user, now) {
  return Boolean(user.selfExcludedUntil) && Date.parse(user.selfExcludedUntil) > now.getTime();
}
