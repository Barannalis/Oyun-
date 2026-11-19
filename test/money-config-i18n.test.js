import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, formatMoney, mulBps, mulRatio, parseDecimalOdds } from '../src/core/money.js';
import { ageOn } from '../src/core/domain.js';
import { validateJurisdiction } from '../src/config/validate.js';
import { loadConfig } from '../src/config/load.js';
import { createTranslator } from '../src/i18n/index.js';
import { ROOT, profile } from './helpers.js';
import { join } from 'node:path';

describe('money', () => {
  test('parses decimal strings into minor units without floats', () => {
    assert.equal(parseMoney('12.50', 'GBP'), 1250);
    assert.equal(parseMoney('0.01', 'USD'), 1);
    assert.equal(parseMoney('7', 'EUR'), 700);
    assert.equal(parseMoney('1.5', 'KWD'), 1500);
    assert.equal(parseMoney('100', 'JPY'), 100);
    assert.equal(parseMoney('99999999999.99', 'USD'), 9999999999999);
  });

  test('rejects precision beyond the currency exponent and malformed input', () => {
    assert.throws(() => parseMoney('1.234', 'USD'), { code: 'invalid_amount' });
    assert.throws(() => parseMoney('1.5', 'JPY'), { code: 'invalid_amount' });
    assert.throws(() => parseMoney('-1', 'USD'), { code: 'invalid_amount' });
    assert.throws(() => parseMoney('1e3', 'USD'), { code: 'invalid_amount' });
    assert.throws(() => parseMoney('10', 'XYZ'), { code: 'unknown_currency' });
  });

  test('formats virtual and ISO currencies', () => {
    assert.equal(formatMoney(12345, 'VC', 'en'), '123.45 VC');
    assert.match(formatMoney(12345, 'GBP', 'en'), /123\.45/);
  });

  test('basis-point and ratio math floors and stays exact for large values', () => {
    assert.equal(mulBps(1000, 21000), 2100);
    assert.equal(mulBps(333, 15000), 499);
    assert.equal(mulRatio(100, 99, 50), 198);
    assert.equal(mulRatio(9007199254740, 99, 98), Number((BigInt(9007199254740) * 99n) / 98n));
  });

  test('decimal odds parse to basis points and reject out-of-range values', () => {
    assert.equal(parseDecimalOdds('2.10'), 21000);
    assert.equal(parseDecimalOdds('1.85'), 18500);
    assert.throws(() => parseDecimalOdds('1.00'), { code: 'invalid_odds' });
    assert.throws(() => parseDecimalOdds('abc'), { code: 'invalid_odds' });
  });

  test('age is computed in whole years on the birthday', () => {
    const now = new Date('2030-06-01T12:00:00Z');
    assert.equal(ageOn('2012-06-01', now), 18);
    assert.equal(ageOn('2012-06-02', now), 17);
  });
});

describe('jurisdiction profile validation', () => {
  test('shipped profiles are valid and start with real money inert', () => {
    const cfg = loadConfig({ configDir: join(ROOT, 'config') });
    assert.deepEqual([...cfg.jurisdictions.keys()].sort(), ['DE', 'GB', 'TR']);
    for (const p of cfg.jurisdictions.values()) {
      assert.equal(p.real_money.legal_review.status, 'pending', `${p.code} must be pending legal review`);
      assert.deepEqual(p.real_money.permitted_categories, []);
      assert.deepEqual(p.real_money.currencies, []);
    }
  });

  test('approved legal review requires a reference and date', () => {
    const p = profile('GB', { real_money: { legal_review: { status: 'approved', reference: null, reviewed_at: null } } });
    assert.throws(() => validateJurisdiction(p, 'GB.json'), /approved legal review/);
  });

  test('virtual currency is forbidden in real-money maps', () => {
    assert.throws(() => validateJurisdiction(profile('GB', { real_money: { currencies: ['VC'] } }), 'GB.json'), /real ISO currencies/);
  });

  test('minimum age below the platform floor is rejected', () => {
    assert.throws(() => validateJurisdiction(profile('GB', { real_money: { minimum_age: 16 } }), 'GB.json'), /minimum_age/);
  });

  test('file name must match the country code', () => {
    assert.throws(() => validateJurisdiction(profile('GB'), 'DE.json'), /does not match file name/);
  });

  test('currency-keyed money maps must hold integers', () => {
    const p = profile('GB', { real_money: { deposit: { min: { GBP: 5.5 } } } });
    assert.throws(() => validateJurisdiction(p, 'GB.json'), /non-negative integer/);
  });

  test('unknown categories are rejected', () => {
    assert.throws(() => validateJurisdiction(profile('GB', { virtual: { categories: ['lotto_xyz'] } }), 'GB.json'), /unknown category/);
  });
});

describe('i18n', () => {
  const i18n = createTranslator({ defaultLocale: 'en' });

  test('resolves regional tags to the base catalog and falls back to default', () => {
    assert.equal(i18n.resolve(['fr-CA']), 'fr');
    assert.equal(i18n.resolve(['xx', 'fr']), 'fr');
    assert.equal(i18n.resolve(['xx']), 'en');
    assert.equal(i18n.resolve([]), 'en');
  });

  test('interpolates parameters and falls back to default locale, then to the key', () => {
    assert.equal(i18n.t('reason.under_age', { age: 18 }, 'en'), 'You must be at least 18 years old.');
    assert.match(i18n.t('reason.under_age', { age: 18 }, 'fr'), /18 ans/);
    assert.equal(i18n.t('reason.not_in_catalog', {}, 'fr'), 'reason.not_in_catalog');
  });

  test('parses Accept-Language in preference order', () => {
    assert.deepEqual(i18n.fromAcceptLanguage('fr-FR,fr;q=0.9,en;q=0.8'), ['fr-FR', 'fr', 'en']);
  });
});
