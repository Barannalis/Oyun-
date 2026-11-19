import { randomUUID } from 'node:crypto';

/** Product modes. `virtual` is a non-monetary simulation; `real` is monetary. */
export const MODES = Object.freeze(['virtual', 'real']);

/**
 * Betting/gaming categories. The platform supports all of them architecturally.
 * Each jurisdiction decides separately which are offered virtually and which
 * (if any) are licensed for real money.
 */
export const CATEGORIES = Object.freeze(['sports', 'esports', 'virtual_sports', 'casino', 'table_games']);

/** KYC verification levels. 0 = unverified. */
export const KYC_LEVELS = Object.freeze([0, 1, 2]);

export const LICENSE_STATUSES = Object.freeze(['pending', 'active', 'suspended', 'revoked']);

export const SELECTIONS = Object.freeze(['home', 'draw', 'away']);

export function newId(prefix) {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

/** Ledger owner keys. Users own wallets; system owners are counterparties. */
export const owners = Object.freeze({
  user: (id) => `user:${id}`,
  house: (mode) => `system:house:${mode}`,
  grants: 'system:grants',
  payments: (provider) => `system:payments:${provider}`,
  withdrawalsHeld: 'system:withdrawals_held',
});

/**
 * Whole years between a YYYY-MM-DD date of birth and `now`, in UTC.
 * @param {string} dateOfBirth
 * @param {Date} now
 */
export function ageOn(dateOfBirth, now) {
  const [y, m, d] = dateOfBirth.split('-').map(Number);
  let age = now.getUTCFullYear() - y;
  const beforeBirthday =
    now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

export function isIsoDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

export function isLocaleTag(s) {
  return typeof s === 'string' && /^[a-z]{2}(-[A-Z]{2})?$/.test(s);
}
