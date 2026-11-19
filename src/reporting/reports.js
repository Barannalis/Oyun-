// Reporting reads ledger-backed tables; it never writes money.

/**
 * Per-jurisdiction reporting, computed from the ledger-backed tables. Tax is
 * computed only when the jurisdiction profile configures a duty rate and a
 * reporting currency. Otherwise it is reported as NOT CONFIGURED. The platform
 * does not guess tax.
 */
export class Reporting {
  constructor({ db, clock, jurisdictions, engine, ledger, licenses, aml }) {
    this.db = db;
    this.clock = clock;
    this.jurisdictions = jurisdictions;
    this.engine = engine;
    this.ledger = ledger;
    this.licenses = licenses;
    this.aml = aml;
  }

  /** Gross gaming revenue per currency for settled activity in [from, to). */
  ggr({ code, mode, from, to }) {
    const byCurrency = new Map();
    const add = (cur, key, n) => {
      if (!byCurrency.has(cur)) byCurrency.set(cur, { stakes: 0, payouts: 0, ggr: 0, bets: 0, rounds: 0 });
      byCurrency.get(cur)[key] += n;
    };
    const bets = this.db.prepare(`SELECT currency, stake, payout FROM bets
      WHERE jurisdiction = ? AND mode = ? AND status IN ('won','lost') AND settled_at >= ? AND settled_at < ?`).all(code, mode, from, to);
    for (const b of bets) { add(b.currency, 'stakes', b.stake); add(b.currency, 'payouts', b.payout); add(b.currency, 'bets', 1); }
    const rounds = this.db.prepare(`SELECT currency, stake, payout FROM casino_rounds
      WHERE jurisdiction = ? AND mode = ? AND created_at >= ? AND created_at < ?`).all(code, mode, from, to);
    for (const r of rounds) { add(r.currency, 'stakes', r.stake); add(r.currency, 'payouts', r.payout); add(r.currency, 'rounds', 1); }
    for (const v of byCurrency.values()) v.ggr = v.stakes - v.payouts;
    return byCurrency;
  }

  jurisdictionReport({ code, mode = 'real', from, to }) {
    const profile = this.jurisdictions.get(code);
    if (!profile) return null;
    const byCurrency = this.ggr({ code, mode, from, to });
    const rate = profile.tax.gaming_duty_bps;
    const reportCurrency = profile.tax.report_currency;
    let tax;
    if (rate === null || reportCurrency === null) {
      tax = { status: 'not_configured', dutyBps: rate, reportCurrency };
    } else {
      const v = byCurrency.get(reportCurrency);
      const base = v ? v.ggr : 0;
      tax = { status: 'estimated', dutyBps: rate, reportCurrency, dutyMinor: Math.floor((base * rate) / 10000), basisMinor: base };
    }
    const reporting = this.aml.list({ status: 'open' }).filter((a) => a.severity === 'report');
    return {
      jurisdiction: code,
      mode,
      period: { from, to },
      byCurrency: Object.fromEntries(byCurrency),
      tax,
      openReportingAlerts: reporting.filter((a) => this.userJurisdiction(a.userId) === code).length,
      generatedAt: this.clock.now().toISOString(),
    };
  }

  userJurisdiction(userId) {
    return this.db.prepare('SELECT country FROM users WHERE id = ?').get(userId)?.country ?? null;
  }

  /**
   * Operational dashboard, one block per jurisdiction. Shows operator switches,
   * license coverage, player and money activity, and compliance queues.
   */
  dashboard({ days = 30 } = {}) {
    const now = this.clock.now();
    const from = new Date(now.getTime() - days * 86400000).toISOString();
    const to = now.toISOString();
    return [...this.jurisdictions.values()].map((profile) => {
      const code = profile.code;
      const op = this.engine.operations(code);
      const lic = this.licenses.list(code);
      const players = this.db.prepare('SELECT COUNT(*) AS n FROM users WHERE country = ?').get(code).n;
      const openBets = this.db.prepare(`SELECT COUNT(*) AS n FROM bets WHERE jurisdiction = ? AND status = 'open'`).get(code).n;
      const pendingWithdrawals = this.db.prepare(
        `SELECT COUNT(*) AS n FROM payment_transactions WHERE jurisdiction = ? AND kind = 'withdrawal' AND status = 'on_hold'`,
      ).get(code).n;
      const openReview = this.db.prepare(
        `SELECT COUNT(*) AS n FROM aml_alerts a JOIN users u ON u.id = a.user_id WHERE u.country = ? AND a.status = 'open' AND a.severity = 'review'`,
      ).get(code).n;
      const openReport = this.db.prepare(
        `SELECT COUNT(*) AS n FROM aml_alerts a JOIN users u ON u.id = a.user_id WHERE u.country = ? AND a.status = 'open' AND a.severity = 'report'`,
      ).get(code).n;
      const virtual = this.ggr({ code, mode: 'virtual', from, to });
      const real = this.ggr({ code, mode: 'real', from, to });
      return {
        jurisdiction: code,
        name: profile.name,
        operations: { served: op.served, virtualEnabled: op.virtualEnabled, realEnabled: op.realEnabled },
        realMoneyGates: {
          legalReview: profile.real_money.legal_review.status,
          licensedNow: this.licenses.hasAnyActive(code, now),
          permittedCategories: profile.real_money.permitted_categories,
        },
        licenses: { total: lic.length, active: lic.filter((l) => l.status === 'active').length },
        players,
        openBets,
        compliance: { openReviewAlerts: openReview, openReportingAlerts: openReport, withdrawalsOnHold: pendingWithdrawals },
        activity: { windowDays: days, virtual: Object.fromEntries(virtual), real: Object.fromEntries(real) },
      };
    });
  }
}
