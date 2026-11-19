import { randomUUID } from 'node:crypto';
import { CATEGORIES, LICENSE_STATUSES } from '../core/domain.js';
import { ValidationError, NotFoundError } from '../core/errors.js';

/**
 * Licenses are scoped to ONE jurisdiction and a set of categories. A license
 * held for one country never authorises activity in another; lookups always
 * filter by jurisdiction code first.
 */
export class LicenseRegistry {
  constructor(db, clock) {
    this.db = db;
    this.clock = clock;
  }

  create(input) {
    const { jurisdiction, regulator, licenseNumber, operatorEntity, categories, status = 'pending', validFrom = null, validUntil = null } = input;
    if (typeof jurisdiction !== 'string' || !/^[A-Z]{2}$/.test(jurisdiction)) throw new ValidationError('invalid_input', { field: 'jurisdiction' });
    for (const [f, v] of Object.entries({ regulator, licenseNumber, operatorEntity })) {
      if (typeof v !== 'string' || !v.trim()) throw new ValidationError('invalid_input', { field: f });
    }
    if (!Array.isArray(categories) || categories.length === 0 || !categories.every((c) => CATEGORIES.includes(c))) {
      throw new ValidationError('invalid_input', { field: 'categories' });
    }
    if (!LICENSE_STATUSES.includes(status)) throw new ValidationError('invalid_input', { field: 'status' });
    for (const d of [validFrom, validUntil]) {
      if (d !== null && Number.isNaN(Date.parse(d))) throw new ValidationError('invalid_input', { field: 'validity' });
    }
    if (validFrom && validUntil && Date.parse(validUntil) <= Date.parse(validFrom)) throw new ValidationError('invalid_input', { field: 'validity' });

    const id = `lic_${randomUUID().replaceAll('-', '')}`;
    const now = this.clock.now().toISOString();
    this.db
      .prepare(`INSERT INTO licenses (id, jurisdiction, regulator, license_number, operator_entity, categories, status, valid_from, valid_until, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, jurisdiction, regulator.trim(), licenseNumber.trim(), operatorEntity.trim(), JSON.stringify([...new Set(categories)]), status, validFrom, validUntil, now, now);
    return this.get(id);
  }

  get(id) {
    const row = this.db.prepare('SELECT * FROM licenses WHERE id = ?').get(id);
    if (!row) throw new NotFoundError('license');
    return mapLicense(row);
  }

  setStatus(id, status) {
    if (!LICENSE_STATUSES.includes(status)) throw new ValidationError('invalid_input', { field: 'status' });
    const current = this.get(id);
    if (current.status === 'revoked') throw new ValidationError('license_revoked_is_terminal');
    this.db.prepare('UPDATE licenses SET status = ?, updated_at = ? WHERE id = ?').run(status, this.clock.now().toISOString(), id);
    return this.get(id);
  }

  list(jurisdiction = null) {
    const rows = jurisdiction
      ? this.db.prepare('SELECT * FROM licenses WHERE jurisdiction = ? ORDER BY created_at').all(jurisdiction)
      : this.db.prepare('SELECT * FROM licenses ORDER BY created_at').all();
    return rows.map(mapLicense);
  }

  /**
   * Decide whether a jurisdiction has a license that covers a category right now.
   * When none is valid, returns the most specific reason so the operator and
   * the player see why.
   * @returns {{ok: true, license: object} | {ok: false, reason: string}}
   */
  check(jurisdiction, category, now = this.clock.now()) {
    const covering = this.list(jurisdiction).filter((l) => l.categories.includes(category));
    const live = covering.find((l) => l.status === 'active' && within(l, now));
    if (live) return { ok: true, license: live };
    if (covering.length === 0) return { ok: false, reason: 'no_active_license' };
    if (covering.some((l) => l.status === 'suspended')) return { ok: false, reason: 'license_suspended' };
    if (covering.some((l) => l.status === 'revoked')) return { ok: false, reason: 'license_revoked' };
    if (covering.some((l) => l.status === 'pending')) return { ok: false, reason: 'license_pending' };
    if (covering.some((l) => l.status === 'active' && l.validUntil && Date.parse(l.validUntil) <= now.getTime())) return { ok: false, reason: 'license_expired' };
    if (covering.some((l) => l.status === 'active' && l.validFrom && Date.parse(l.validFrom) > now.getTime())) return { ok: false, reason: 'license_not_yet_valid' };
    return { ok: false, reason: 'no_active_license' };
  }

  hasAnyActive(jurisdiction, now = this.clock.now()) {
    return this.list(jurisdiction).some((l) => l.status === 'active' && within(l, now));
  }
}

function within(l, now) {
  const t = now.getTime();
  return (!l.validFrom || Date.parse(l.validFrom) <= t) && (!l.validUntil || Date.parse(l.validUntil) > t);
}

function mapLicense(r) {
  return {
    id: r.id,
    jurisdiction: r.jurisdiction,
    regulator: r.regulator,
    licenseNumber: r.license_number,
    operatorEntity: r.operator_entity,
    categories: JSON.parse(r.categories),
    status: r.status,
    validFrom: r.valid_from,
    validUntil: r.valid_until,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
