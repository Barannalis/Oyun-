/** Append-only record of every administrative and compliance-relevant change. */
export class AuditLog {
  constructor(db, clock) {
    this.db = db;
    this.clock = clock;
  }

  record({ actor, action, jurisdiction = null, subject = null, details = {} }) {
    this.db
      .prepare('INSERT INTO audit_log (at, actor, action, jurisdiction, subject, details) VALUES (?, ?, ?, ?, ?, ?)')
      .run(this.clock.now().toISOString(), actor, action, jurisdiction, subject, JSON.stringify(details));
  }

  list({ limit = 100, jurisdiction = null } = {}) {
    const rows = jurisdiction
      ? this.db.prepare('SELECT * FROM audit_log WHERE jurisdiction = ? ORDER BY id DESC LIMIT ?').all(jurisdiction, limit)
      : this.db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit);
    return rows.map((r) => ({ ...r, details: JSON.parse(r.details) }));
  }
}
