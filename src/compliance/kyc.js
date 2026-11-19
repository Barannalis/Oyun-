import { KYC_LEVELS } from '../core/domain.js';
import { ValidationError, NotFoundError } from '../core/errors.js';

/**
 * KYC level storage. Verification itself is delegated to a provider.
 *
 * Provider contract (for real integrations; implement and register in code):
 *   id: string
 *   verify({ userId, targetLevel }) -> Promise<{ status: 'approved'|'pending'|'rejected', level?: number, providerRef?: string }>
 *
 * The MVP ships only the manual path: an administrator records the outcome
 * after checking documents elsewhere. The jurisdiction profile decides which
 * level each action requires; this module only stores what was verified.
 */
export class KycService {
  constructor({ db, clock, audit }) {
    this.db = db;
    this.clock = clock;
    this.audit = audit;
  }

  setLevel({ userId, level, actor, providerRef = null }) {
    if (!KYC_LEVELS.includes(level)) throw new ValidationError('invalid_input', { field: 'level' });
    const user = this.db.prepare('SELECT id, country, kyc_level FROM users WHERE id = ?').get(userId);
    if (!user) throw new NotFoundError('user');
    this.db.prepare('UPDATE users SET kyc_level = ? WHERE id = ?').run(level, userId);
    this.audit.record({
      actor,
      action: 'kyc.level_set',
      jurisdiction: user.country,
      subject: userId,
      details: { from: user.kyc_level, to: level, providerRef },
    });
    return level;
  }
}
