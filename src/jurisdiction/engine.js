import { CATEGORIES, MODES, ageOn } from '../core/domain.js';
import { ValidationError } from '../core/errors.js';
import { isSelfExcluded } from '../compliance/responsible.js';

/**
 * The jurisdiction engine is the only component that decides whether an action
 * is allowed for a player. Every decision is evaluated independently for the
 * player's country. Nothing carries over from another country.
 *
 * Real money requires ALL of:
 *   1. the profile's legal_review.status === "approved" (config, in git);
 *   2. the operator switch real_enabled for that country (database, kill switch);
 *   3. an active license in that SAME country covering the category (database);
 *   4. the category permitted by law for that country (config);
 *   5. the player's age, KYC level, self-exclusion, limits and holds to pass.
 *
 * Virtual mode requires only the country's virtual.enabled and the operator's
 * virtual switch. It never depends on a license.
 *
 * Every rule is fail-closed: a missing policy field denies the action.
 */
export class JurisdictionEngine {
  /**
   * @param {{db: import('../store/db.js').Database, clock: {now: () => Date},
   *          jurisdictions: Map<string, object>, licenses: import('./licenses.js').LicenseRegistry,
   *          responsible: import('../compliance/responsible.js').ResponsibleGambling,
   *          aml: import('../compliance/aml.js').AmlMonitor, platformFloor: number}} deps
   */
  constructor({ db, clock, jurisdictions, licenses, responsible, aml, platformFloor }) {
    this.db = db;
    this.clock = clock;
    this.jurisdictions = jurisdictions;
    this.licenses = licenses;
    this.responsible = responsible;
    this.aml = aml;
    this.platformFloor = platformFloor;
  }

  profile(code) { return this.jurisdictions.get(code) ?? null; }

  /** Operator switches. Default (no row) is fully off. */
  operations(code) {
    const row = this.db.prepare('SELECT * FROM jurisdiction_operations WHERE code = ?').get(code);
    if (!row) return { code, served: false, virtualEnabled: false, realEnabled: false, updatedAt: null, updatedBy: null };
    return {
      code,
      served: row.served === 1,
      virtualEnabled: row.virtual_enabled === 1,
      realEnabled: row.real_enabled === 1,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
    };
  }

  listOperations() {
    return [...this.jurisdictions.keys()].map((code) => this.operations(code));
  }

  /** Writes operator switches. Real money cannot be enabled while not served. */
  setOperations({ code, served, virtualEnabled, realEnabled, actor, now }) {
    if (!this.jurisdictions.has(code)) throw new ValidationError('unknown_jurisdiction', { code });
    for (const v of [served, virtualEnabled, realEnabled]) {
      if (typeof v !== 'boolean') throw new ValidationError('invalid_input', { field: 'switches' });
    }
    if (realEnabled && !served) throw new ValidationError('real_requires_served');
    this.db
      .prepare(`INSERT INTO jurisdiction_operations (code, served, virtual_enabled, real_enabled, updated_at, updated_by)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(code) DO UPDATE SET served = excluded.served, virtual_enabled = excluded.virtual_enabled,
                  real_enabled = excluded.real_enabled, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
      .run(code, served ? 1 : 0, virtualEnabled ? 1 : 0, realEnabled ? 1 : 0, now.toISOString(), actor);
    return this.operations(code);
  }

  /**
   * Minimum age that applies. Real money adds the jurisdiction's own minimum.
   * Returns null when real money has no age policy (fail closed).
   */
  minimumAge(profile, mode) {
    if (mode === 'virtual') return this.platformFloor;
    const own = profile.real_money.minimum_age;
    return own === null ? null : Math.max(this.platformFloor, own);
  }

  /**
   * Decide an action. Returns every reason that applies, so the caller can show
   * the player (or an operator) the full picture.
   *
   * @param {{user: {id: string, country: string, dateOfBirth: string, kycLevel: number,
   *                 selfExcludedUntil: string|null, status: string},
   *          mode: 'virtual'|'real', category?: string|null, gameKey?: string|null,
   *          action: 'register'|'view'|'bet'|'play'|'deposit'|'withdraw',
   *          currency?: string|null, amountMinor?: number, method?: string|null}} input
   * @returns {{allowed: boolean, reasons: Array<{code: string, params?: object}>, jurisdiction: string|null}}
   */
  evaluate(input) {
    const { user, mode, category = null, gameKey = null, action, currency = null, amountMinor = 0, method = null } = input;
    if (!MODES.includes(mode)) throw new ValidationError('invalid_mode');
    if (category !== null && !CATEGORIES.includes(category)) throw new ValidationError('unknown_category');
    const now = this.clock.now();
    const reasons = [];
    const add = (code, params) => reasons.push(params ? { code, params } : { code });
    const finish = (code) => ({ allowed: reasons.length === 0, reasons, jurisdiction: code });

    const profile = this.profile(user.country);
    if (!profile) return { allowed: false, reasons: [{ code: 'country_not_supported' }], jurisdiction: null };
    const op = this.operations(profile.code);
    if (!op.served) return { allowed: false, reasons: [{ code: 'country_not_served' }], jurisdiction: profile.code };

    const minAge = this.minimumAge(profile, mode);
    if (minAge === null) add('age_policy_missing');
    else if (ageOn(user.dateOfBirth, now) < minAge) add('under_age', { age: minAge });
    if (user.status !== 'active') add('account_inactive');
    if (action === 'register') return finish(profile.code);

    if (mode === 'virtual') {
      if (!profile.virtual.enabled || !op.virtualEnabled) add('virtual_disabled');
      if (category && !profile.virtual.categories.includes(category)) add('category_not_available');
      if (gameKey && profile.virtual.restricted_games.includes(gameKey)) add('game_restricted');
      return finish(profile.code);
    }

    // ---- real money ----
    const rm = profile.real_money;
    if (!op.realEnabled) add('real_money_disabled_by_operator');
    if (rm.legal_review.status !== 'approved') add('legal_review_pending');
    if (currency !== null && !rm.currencies.includes(currency)) add('currency_not_allowed', { currency });

    if (category) {
      if (!rm.permitted_categories.includes(category)) add('category_not_permitted');
      else {
        const lic = this.licenses.check(profile.code, category, now);
        if (!lic.ok) add(lic.reason);
      }
    } else if (!this.licenses.hasAnyActive(profile.code, now)) {
      add('no_active_license');
    }

    if (gameKey && rm.restricted_games.includes(gameKey)) add('game_restricted');
    if (isSelfExcluded(user, now)) add('self_excluded');

    const kycRequired = action === 'withdraw' ? rm.kyc.withdrawal_level : rm.kyc.deposit_level;
    if (kycRequired === null) add('kyc_policy_missing');
    else if (user.kycLevel < kycRequired) add('kyc_level_insufficient', { required: kycRequired });

    if (action === 'deposit' || action === 'withdraw') {
      const section = action === 'deposit' ? rm.deposit : rm.withdrawal;
      if (method !== null && !section.methods.includes(method)) add('payment_method_unavailable');
      if (currency !== null) {
        const min = section.min[currency];
        const max = section.max_per_tx[currency];
        if (min !== undefined && amountMinor < min) add('amount_below_minimum', { min });
        if (max !== undefined && amountMinor > max) add('amount_above_maximum', { max });
      }
    }

    if (action === 'deposit' && currency !== null) {
      const limit = this.responsible.effectiveDailyDeposit(user.id, currency, now);
      if (limit !== null && this.depositedToday(user.id, currency, now) + amountMinor > limit) {
        add('daily_deposit_limit_exceeded', { limit });
      }
    }
    if (action === 'withdraw' && this.aml.hasOpenReview(user.id)) add('aml_hold');

    return finish(profile.code);
  }

  /** Player's availability matrix for the UI and the /me endpoint. */
  availability(user) {
    const out = {};
    for (const mode of MODES) {
      out[mode] = {};
      for (const category of CATEGORIES) {
        out[mode][category] = this.evaluate({
          user,
          mode,
          category,
          action: 'bet',
          currency: mode === 'real' ? null : 'VC',
        });
      }
    }
    return out;
  }

  /** Completed or pending deposit total for the current UTC day. */
  depositedToday(userId, currency, now) {
    const start = new Date(now);
    start.setUTCHours(0, 0, 0, 0);
    return this.db
      .prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM payment_transactions
                WHERE user_id = ? AND kind = 'deposit' AND currency = ? AND status IN ('pending', 'completed') AND created_at >= ?`)
      .get(userId, currency, start.toISOString()).total;
  }
}
