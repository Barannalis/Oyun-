import { CURRENCIES } from '../core/money.js';
import { CATEGORIES, KYC_LEVELS, isLocaleTag } from '../core/domain.js';
import { ConfigError } from '../core/errors.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStrList = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string' && x.length > 0);
const isNonNegInt = (v) => Number.isSafeInteger(v) && v >= 0;

/** Money map: { "<ISO currency>": minor units }. Keys must be known, non-virtual currencies. */
function checkMoneyMap(v, path, errors, { allowVirtual = false } = {}) {
  if (!isObj(v)) { errors.push(`${path} must be an object keyed by currency`); return; }
  for (const [cur, amt] of Object.entries(v)) {
    const known = CURRENCIES[cur] && (allowVirtual || !CURRENCIES[cur].virtual);
    if (!known) errors.push(`${path}.${cur}: unknown or disallowed currency`);
    if (!isNonNegInt(amt)) errors.push(`${path}.${cur}: must be a non-negative integer (minor units)`);
  }
}

/**
 * Validates one jurisdiction profile. Returns nothing; throws ConfigError with
 * every problem listed. Keys starting with "_" are free-form notes.
 * @param {any} p
 * @param {string} fileName
 */
export function validateJurisdiction(p, fileName) {
  const e = [];
  if (!isObj(p)) throw new ConfigError(`${fileName}: profile must be an object`);

  if (typeof p.code !== 'string' || !/^[A-Z]{2}$/.test(p.code)) e.push('code must be ISO 3166-1 alpha-2');
  if (fileName && p.code && fileName !== `${p.code}.json`) e.push(`code "${p.code}" does not match file name`);
  if (typeof p.name !== 'string' || !p.name) e.push('name is required');
  if (!Array.isArray(p.locales) || !p.locales.length || !p.locales.every(isLocaleTag)) e.push('locales must be a non-empty list of locale tags');
  if (!isLocaleTag(p.default_locale) || !(p.locales || []).includes(p.default_locale)) e.push('default_locale must be one of locales');

  const v = p.virtual;
  if (!isObj(v) || typeof v.enabled !== 'boolean') e.push('virtual.enabled must be boolean');
  else {
    if (!isStrList(v.categories) || !v.categories.every((c) => CATEGORIES.includes(c))) e.push('virtual.categories contains unknown category');
    if (!isStrList(v.restricted_games ?? [])) e.push('virtual.restricted_games must be a list of strings');
  }

  const r = p.real_money;
  if (!isObj(r)) e.push('real_money is required (use the placeholder shape if not yet approved)');
  else {
    const lr = r.legal_review;
    if (!isObj(lr) || !['pending', 'approved'].includes(lr.status)) e.push('real_money.legal_review.status must be pending|approved');
    else if (lr.status === 'approved' && (!lr.reference || !lr.reviewed_at)) e.push('approved legal review needs reference and reviewed_at');
    if (r.minimum_age !== null && !(Number.isSafeInteger(r.minimum_age) && r.minimum_age >= 18 && r.minimum_age <= 100)) e.push('real_money.minimum_age must be null or an integer 18..100');
    if (!isStrList(r.permitted_categories ?? []) || !(r.permitted_categories ?? []).every((c) => CATEGORIES.includes(c))) e.push('real_money.permitted_categories contains unknown category');
    if (!Array.isArray(r.currencies) || !r.currencies.every((c) => CURRENCIES[c] && !CURRENCIES[c].virtual)) e.push('real_money.currencies must be real ISO currencies');
    if (!isStrList(r.restricted_games ?? [])) e.push('real_money.restricted_games must be a list of strings');
    const k = r.kyc;
    if (!isObj(k) || ![k.deposit_level, k.withdrawal_level].every((x) => x === null || KYC_LEVELS.includes(x))) e.push('real_money.kyc levels must be null or 0..2');
    for (const dir of ['deposit', 'withdrawal']) {
      const d = r[dir];
      if (!isObj(d) || !isStrList(d.methods ?? [])) { e.push(`real_money.${dir}.methods must be a list`); continue; }
      checkMoneyMap(d.min ?? {}, `real_money.${dir}.min`, e);
      checkMoneyMap(d.max_per_tx ?? {}, `real_money.${dir}.max_per_tx`, e);
    }
    if (!isObj(r.aml)) e.push('real_money.aml is required');
    else for (const k2 of ['single_transaction_review', 'daily_review', 'reporting']) checkMoneyMap(r.aml[k2] ?? {}, `real_money.aml.${k2}`, e);
    const rg = r.responsible_gambling;
    if (!isObj(rg)) e.push('real_money.responsible_gambling is required');
    else {
      if (!isStrList(rg.required_tools ?? [])) e.push('responsible_gambling.required_tools must be a list');
      if (!isNonNegInt(rg.cooling_off_hours)) e.push('responsible_gambling.cooling_off_hours must be a non-negative integer');
      if (!(Number.isSafeInteger(rg.self_exclusion_min_days) && rg.self_exclusion_min_days >= 1)) e.push('responsible_gambling.self_exclusion_min_days must be >= 1');
      checkMoneyMap(rg.max_daily_deposit ?? {}, 'responsible_gambling.max_daily_deposit', e);
    }
    if (r.currencies && (r.deposit?.min || r.deposit?.max_per_tx)) {
      for (const cur of [...Object.keys(r.deposit.min ?? {}), ...Object.keys(r.deposit.max_per_tx ?? {})]) {
        if (!r.currencies.includes(cur)) e.push(`real_money.deposit limit for ${cur} but ${cur} is not in real_money.currencies`);
      }
    }
  }

  const t = p.tax;
  if (!isObj(t)) e.push('tax is required');
  else {
    if (!(t.gaming_duty_bps === null || (Number.isSafeInteger(t.gaming_duty_bps) && t.gaming_duty_bps >= 0 && t.gaming_duty_bps <= 10000))) e.push('tax.gaming_duty_bps must be null or 0..10000');
    if (!(t.report_currency === null || (CURRENCIES[t.report_currency] && !CURRENCIES[t.report_currency].virtual))) e.push('tax.report_currency must be null or an ISO currency');
    if (!['monthly', 'quarterly', 'annual'].includes(t.report_period)) e.push('tax.report_period must be monthly|quarterly|annual');
  }

  if (e.length) throw new ConfigError(`${fileName || p.code}: ${e.join('; ')}`);
}

/** Validates the platform-wide settings file. */
export function validatePlatform(p) {
  const e = [];
  if (!isObj(p)) throw new ConfigError('platform.json must be an object');
  if (!(Number.isSafeInteger(p.minimum_age_floor) && p.minimum_age_floor >= 18)) e.push('minimum_age_floor must be >= 18 (platform floor cannot be lowered)');
  if (!isLocaleTag(p.default_locale) || !(p.locales || []).includes(p.default_locale)) e.push('default_locale must be in locales');
  if (!isObj(p.virtual) || !isNonNegInt(p.virtual.signup_grant_minor)) e.push('virtual.signup_grant_minor must be a non-negative integer');
  checkMoneyMap(p.betting?.max_stake_minor ?? {}, 'betting.max_stake_minor', e, { allowVirtual: true });
  checkMoneyMap(p.betting?.min_stake_minor ?? {}, 'betting.min_stake_minor', e, { allowVirtual: true });
  if (!isObj(p.payments?.methods ?? {})) e.push('payments.methods must be an object');
  if (e.length) throw new ConfigError(`platform.json: ${e.join('; ')}`);
}
