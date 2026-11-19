import { randomUUID } from 'node:crypto';
import { NotFoundError } from '../core/errors.js';

/**
 * Transaction monitoring. Rules are configured per jurisdiction in money
 * terms, keyed by currency. This module raises alerts; it never decides that
 * something is reportable or fraudulent. People decide, and the audit log
 * records who did.
 *
 *  - severity "review": open alerts hold the player's withdrawals until cleared.
 *  - severity "report": a threshold is crossed that the jurisdiction says must
 *    be reported. It is recorded so the reporting job can pick it up.
 */
export class AmlMonitor {
  constructor({ db, clock }) {
    this.db = db;
    this.clock = clock;
  }

  /**
   * @param {{profile: object, userId: string, refId: string, direction: 'deposit'|'withdrawal',
   *          currency: string, amountMinor: number, dailyTotalMinor: number}} input
   * @returns {Array<object>} alerts raised
   */
  evaluate({ profile, userId, refId, currency, amountMinor, dailyTotalMinor }) {
    const aml = profile.real_money.aml;
    const raised = [];
    const single = aml.single_transaction_review[currency];
    if (single !== undefined && amountMinor >= single) {
      raised.push({ rule: 'single_transaction_review', severity: 'review', details: { threshold: single, amount: amountMinor } });
    }
    const daily = aml.daily_review[currency];
    if (daily !== undefined && dailyTotalMinor >= daily) {
      raised.push({ rule: 'daily_volume_review', severity: 'review', details: { threshold: daily, total: dailyTotalMinor } });
    }
    const report = aml.reporting[currency];
    if (report !== undefined && amountMinor >= report) {
      raised.push({ rule: 'reporting_threshold', severity: 'report', details: { threshold: report, amount: amountMinor } });
    }
    const now = this.clock.now().toISOString();
    return raised.map((a) => {
      const id = `aml_${randomUUID().replaceAll('-', '')}`;
      this.db
        .prepare('INSERT INTO aml_alerts (id, user_id, ref_id, rule, severity, status, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, userId, refId, a.rule, a.severity, 'open', JSON.stringify(a.details), now);
      return { id, userId, refId, rule: a.rule, severity: a.severity, details: a.details, status: 'open' };
    });
  }

  /** True when the player has any open review alert (blocks withdrawals). */
  hasOpenReview(userId) {
    return this.db
      .prepare("SELECT COUNT(*) AS n FROM aml_alerts WHERE user_id = ? AND status = 'open' AND severity = 'review'")
      .get(userId).n > 0;
  }

  /** Open review alerts tied to one payment reference. */
  openReviewFor(refId) {
    return this.db
      .prepare("SELECT COUNT(*) AS n FROM aml_alerts WHERE ref_id = ? AND status = 'open' AND severity = 'review'")
      .get(refId).n;
  }

  list({ status = 'open' } = {}) {
    return this.db
      .prepare('SELECT * FROM aml_alerts WHERE status = ? ORDER BY created_at DESC LIMIT 500')
      .all(status)
      .map(mapAlert);
  }

  resolve(alertId, actor) {
    const row = this.db.prepare('SELECT * FROM aml_alerts WHERE id = ?').get(alertId);
    if (!row) throw new NotFoundError('aml_alert');
    this.db
      .prepare("UPDATE aml_alerts SET status = 'cleared', resolved_at = ?, resolved_by = ? WHERE id = ?")
      .run(this.clock.now().toISOString(), actor, alertId);
    return mapAlert(this.db.prepare('SELECT * FROM aml_alerts WHERE id = ?').get(alertId));
  }
}

function mapAlert(r) {
  return {
    id: r.id,
    userId: r.user_id,
    refId: r.ref_id,
    rule: r.rule,
    severity: r.severity,
    status: r.status,
    details: JSON.parse(r.details),
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
    resolvedBy: r.resolved_by,
  };
}
