import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { newId, isIsoDate, owners, MODES } from '../core/domain.js';
import { ValidationError, ForbiddenError, ConflictError, AuthError, NotFoundError } from '../core/errors.js';
import { getCurrency } from '../core/money.js';

const USERNAME_RE = /^[A-Za-z0-9_]{3,32}$/;
const MIN_PASSWORD = 10;

/**
 * Accounts, password login and opaque session tokens. Only a SHA-256 hash of
 * each session token is stored. Passwords use scrypt. This is an MVP auth
 * layer; a production deployment should put OIDC/SSO in front of it.
 */
export class AccountService {
  constructor({ db, clock, engine, ledger, platform, i18n }) {
    this.db = db;
    this.clock = clock;
    this.engine = engine;
    this.ledger = ledger;
    this.platform = platform;
    this.i18n = i18n;
  }

  register({ username, password, displayName, country, dateOfBirth, locale }) {
    if (typeof username !== 'string' || !USERNAME_RE.test(username)) throw new ValidationError('invalid_input', { field: 'username' });
    if (typeof password !== 'string' || password.length < MIN_PASSWORD) throw new ValidationError('invalid_input', { field: 'password' });
    if (typeof displayName !== 'string' || !displayName.trim() || displayName.length > 64) throw new ValidationError('invalid_input', { field: 'displayName' });
    if (typeof country !== 'string' || !/^[A-Z]{2}$/.test(country)) throw new ValidationError('invalid_input', { field: 'country' });
    if (!isIsoDate(dateOfBirth)) throw new ValidationError('invalid_date_of_birth');
    const chosenLocale = locale ? this.i18n.resolve([locale]) : this.platform.default_locale;
    if (locale && !this.platform.locales.includes(chosenLocale)) throw new ValidationError('invalid_locale');

    const exists = this.db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(username);
    if (exists) throw new ConflictError('username_taken');

    // Eligibility to open an account is decided by the jurisdiction engine,
    // for the country the player declares.
    const id = newId('usr');
    const candidate = { id, country, dateOfBirth, kycLevel: 0, selfExcludedUntil: null, status: 'active' };
    const decision = this.engine.evaluate({ user: candidate, mode: 'virtual', action: 'register' });
    if (!decision.allowed) throw new ForbiddenError(decision.reasons);

    const now = this.clock.now().toISOString();
    const grant = this.platform.virtual.signup_grant_minor;
    return this.db.transaction(() => {
      this.db
        .prepare(`INSERT INTO users (id, username, password_hash, display_name, country, date_of_birth, locale, kyc_level, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`)
        .run(id, username, hashPassword(password), displayName.trim(), country, dateOfBirth, chosenLocale, now);
      if (grant > 0) {
        this.ledger.post({
          type: 'virtual_signup_grant',
          mode: 'virtual',
          currency: 'VC',
          legs: [
            { owner: owners.grants, amount: -grant },
            { owner: owners.user(id), amount: grant },
          ],
          idempotencyKey: `grant:signup:${id}`,
        });
      }
      return this.issueSession(id);
    });
  }

  login({ username, password }) {
    const row = this.db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(String(username ?? ''));
    // Always run a hash so timing does not reveal whether the username exists.
    const ok = row ? verifyPassword(String(password ?? ''), row.password_hash) : (verifyPassword(String(password ?? ''), DUMMY_HASH), false);
    if (!ok) throw new AuthError('invalid_credentials');
    return this.issueSession(row.id);
  }

  issueSession(userId) {
    const token = randomBytes(32).toString('base64url');
    this.db
      .prepare('INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)')
      .run(sha256(token), userId, this.clock.now().toISOString());
    return { token, user: this.toUser(this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId)) };
  }

  logout(token) {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  }

  /** @returns {object|null} domain user for a bearer token */
  authenticate(token) {
    if (!token) return null;
    const row = this.db
      .prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`)
      .get(sha256(token));
    return row ? this.toUser(row) : null;
  }

  getUser(id) {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!row) throw new NotFoundError('user');
    return this.toUser(row);
  }

  toUser(r) {
    return {
      id: r.id,
      username: r.username,
      displayName: r.display_name,
      country: r.country,
      dateOfBirth: r.date_of_birth,
      locale: r.locale,
      kycLevel: r.kyc_level,
      selfExcludedUntil: r.self_excluded_until,
      role: r.role,
      status: r.status,
      createdAt: r.created_at,
    };
  }

  /** Wallets grouped by mode, for the player's own view. */
  wallets(userId) {
    const rows = this.ledger.wallets(owners.user(userId));
    return MODES.map((mode) => ({
      mode,
      balances: rows.filter((w) => w.mode === mode).map((w) => ({ currency: w.currency, exponent: getCurrency(w.currency).exponent, amountMinor: w.balance })),
    }));
  }
}

function sha256(s) {
  return createHash('sha256').update(s).digest('hex');
}

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, SCRYPT);
  return timingSafeEqual(actual, expected);
}

const DUMMY_HASH = hashPassword(randomBytes(16).toString('hex'));
