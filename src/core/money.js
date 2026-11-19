/**
 * Money is always an integer count of minor units (e.g. cents) plus a currency
 * code. Floats never touch balances. Odds and rates use basis points (bp):
 * 10000 bp = 1.0.
 */
import { ValidationError } from './errors.js';

/**
 * Currency registry. ISO 4217 exponents. `VC` is the platform's non-convertible
 * virtual currency and must never be used in real-money wallets.
 */
export const CURRENCIES = Object.freeze({
  VC: { code: 'VC', exponent: 2, virtual: true, name: 'Virtual Credits' },
  USD: { code: 'USD', exponent: 2, virtual: false },
  EUR: { code: 'EUR', exponent: 2, virtual: false },
  GBP: { code: 'GBP', exponent: 2, virtual: false },
  TRY: { code: 'TRY', exponent: 2, virtual: false },
  CHF: { code: 'CHF', exponent: 2, virtual: false },
  SEK: { code: 'SEK', exponent: 2, virtual: false },
  CAD: { code: 'CAD', exponent: 2, virtual: false },
  AUD: { code: 'AUD', exponent: 2, virtual: false },
  BRL: { code: 'BRL', exponent: 2, virtual: false },
  INR: { code: 'INR', exponent: 2, virtual: false },
  JPY: { code: 'JPY', exponent: 0, virtual: false },
  KWD: { code: 'KWD', exponent: 3, virtual: false },
});

/** @param {string} code */
export function getCurrency(code) {
  const c = CURRENCIES[code];
  if (!c) throw new ValidationError('unknown_currency', { currency: code });
  return c;
}

/**
 * Parse a decimal string such as "12.50" into minor units for a currency.
 * Rejects floats with more precision than the currency allows.
 * @param {string|number} input
 * @param {string} currency
 * @returns {number}
 */
export function parseMoney(input, currency) {
  const c = getCurrency(currency);
  const s = String(input).trim();
  const re = c.exponent === 0 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{1,${c.exponent}})?$`);
  if (!re.test(s)) throw new ValidationError('invalid_amount', { amount: s, currency });
  const [whole, frac = ''] = s.split('.');
  const padded = (frac + '0'.repeat(c.exponent)).slice(0, c.exponent);
  const minor = Number(whole) * 10 ** c.exponent + (padded ? Number(padded) : 0);
  if (!Number.isSafeInteger(minor)) throw new ValidationError('invalid_amount', { amount: s });
  return minor;
}

/**
 * Format minor units for display. Display only; never parse the output back.
 * @param {number} minor
 * @param {string} currency
 * @param {string} [locale]
 */
export function formatMoney(minor, currency, locale = 'en') {
  const c = getCurrency(currency);
  const value = minor / 10 ** c.exponent;
  const fmt = { minimumFractionDigits: c.exponent, maximumFractionDigits: c.exponent };
  if (c.virtual) return `${new Intl.NumberFormat(locale, fmt).format(value)} ${c.code}`;
  return new Intl.NumberFormat(locale, { ...fmt, style: 'currency', currency: c.code }).format(value);
}

/** Floor(amount * num / den) using BigInt to avoid precision loss. */
export function mulRatio(amount, num, den) {
  return Number((BigInt(amount) * BigInt(num)) / BigInt(den));
}

/** Floor(amount * bp / 10000). */
export function mulBps(amount, bp) {
  return mulRatio(amount, bp, 10000);
}

/**
 * Parse decimal odds ("2.10") into basis points (21000).
 * @param {string|number} input
 */
export function parseDecimalOdds(input) {
  const s = String(input).trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) throw new ValidationError('invalid_odds', { odds: s });
  const [whole, frac = ''] = s.split('.');
  const bp = Number(whole) * 10000 + Number((frac + '00').slice(0, 2)) * 100;
  if (bp < 10100 || bp > 100000) throw new ValidationError('invalid_odds', { odds: s });
  return bp;
}

/** Throws unless value is a positive safe integer of minor units. */
export function assertPositiveMinor(value, field = 'amount') {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ValidationError('invalid_amount', { field });
  }
  return value;
}
