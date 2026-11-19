import { NotFoundError, ValidationError } from '../core/errors.js';

/**
 * Central administration. Every mutating operation writes an audit record with
 * the actor, so compliance can answer "who changed this, when, and why".
 */
export class AdminService {
  constructor({ db, clock, audit, engine, licenses, sportsbook, kyc, aml, payments, accounts, responsible, ledger, reporting, jurisdictions }) {
    Object.assign(this, { db, clock, audit, engine, licenses, sportsbook, kyc, aml, payments, accounts, responsible, ledger, reporting, jurisdictions });
  }

  /** Profiles plus live operator state. Legal fields are read-only here by design. */
  listJurisdictions() {
    return [...this.jurisdictions.values()].map((p) => ({
      code: p.code,
      name: p.name,
      locales: p.locales,
      defaultLocale: p.default_locale,
      virtual: p.virtual,
      realMoney: {
        legalReview: p.real_money.legal_review.status,
        minimumAge: p.real_money.minimum_age,
        permittedCategories: p.real_money.permitted_categories,
        currencies: p.real_money.currencies,
        restrictedGames: p.real_money.restricted_games,
        deposit: { methods: p.real_money.deposit.methods },
        withdrawal: { methods: p.real_money.withdrawal.methods },
      },
      tax: p.tax,
      operations: this.engine.operations(p.code),
    }));
  }

  /** Kill switches. Changing these is audited and takes effect on the next request. */
  setOperations({ actor, code, served, virtualEnabled, realEnabled }) {
    const before = this.engine.operations(code);
    const after = this.engine.setOperations({ code, served, virtualEnabled, realEnabled, actor, now: this.clock.now() });
    this.audit.record({
      actor,
      action: 'jurisdiction.operations_set',
      jurisdiction: code,
      details: {
        before: { served: before.served, virtualEnabled: before.virtualEnabled, realEnabled: before.realEnabled },
        after: { served: after.served, virtualEnabled: after.virtualEnabled, realEnabled: after.realEnabled },
      },
    });
    return after;
  }

  createLicense({ actor, input }) {
    if (!this.jurisdictions.has(input.jurisdiction)) throw new ValidationError('unknown_jurisdiction');
    const lic = this.licenses.create(input);
    this.audit.record({ actor, action: 'license.created', jurisdiction: lic.jurisdiction, subject: lic.id, details: { categories: lic.categories, status: lic.status, regulator: lic.regulator } });
    return lic;
  }

  setLicenseStatus({ actor, id, status }) {
    const before = this.licenses.get(id);
    const after = this.licenses.setStatus(id, status);
    this.audit.record({ actor, action: 'license.status_set', jurisdiction: after.jurisdiction, subject: id, details: { from: before.status, to: status } });
    return after;
  }

  async syncSports({ actor, provider }) {
    return this.sportsbook.sync(provider, actor);
  }

  listAlerts(status) { return this.aml.list({ status }); }
  listWithdrawals(status) { return this.payments.listByStatus(status); }

  settleEvent({ actor, eventId, result }) {
    return this.sportsbook.settle({ eventId, result, actor });
  }

  setKyc({ actor, userId, level }) {
    return this.kyc.setLevel({ userId, level, actor });
  }

  resolveAlert({ actor, id }) {
    return this.aml.resolve(id, actor);
  }

  async releaseWithdrawal({ actor, id }) {
    return this.payments.releaseWithdrawal(id, actor);
  }

  grantVirtual({ actor, userId, amountMinor }) {
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new ValidationError('invalid_amount');
    const user = this.accounts.getUser(userId);
    this.ledger.post({
      type: 'virtual_admin_grant',
      mode: 'virtual',
      currency: 'VC',
      legs: [
        { owner: 'system:grants', amount: -amountMinor },
        { owner: `user:${user.id}`, amount: amountMinor },
      ],
    });
    this.audit.record({ actor, action: 'virtual.granted', jurisdiction: user.country, subject: userId, details: { amountMinor } });
    return { userId, amountMinor };
  }

  setSelfExclusionByOperator({ actor, userId, untilIso }) {
    const user = this.accounts.getUser(userId);
    const profile = this.engine.profile(user.country);
    if (!profile) throw new NotFoundError('jurisdiction');
    const until = this.responsible.selfExclude({ userId, profile, currentExclusionUntil: user.selfExcludedUntil, untilIso });
    this.audit.record({ actor, action: 'responsible.self_exclusion_operator_set', jurisdiction: user.country, subject: userId, details: { until } });
    return until;
  }
}
