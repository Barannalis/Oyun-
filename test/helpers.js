import { createHmac } from 'node:crypto';
import { loadConfig } from '../src/config/load.js';
import { validateJurisdiction, validatePlatform } from '../src/config/validate.js';
import { createPlatform } from '../src/app.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ADMIN_TOKEN = 'test-admin-token-0123456789abcdef';
export const WEBHOOK_SECRET = 'test-webhook-secret-0123456789';
export const NOW = new Date('2030-06-01T12:00:00.000Z');

/** Controllable clock. */
export class FakeClock {
  constructor(start = NOW) { this.t = start.getTime(); }
  now() { return new Date(this.t); }
  advance(ms) { this.t += ms; return this; }
}

/** Platform config with a test-only monetary provider mapped to the "card" method. */
export function testPlatformConfig(extra = {}) {
  const platform = {
    name: 'test',
    minimum_age_floor: 18,
    default_locale: 'en',
    locales: ['en', 'fr'],
    virtual: { signup_grant_minor: 1000000 },
    betting: { min_stake_minor: { VC: 100 }, max_stake_minor: { VC: 1000000 } },
    payments: { methods: { card: 'psp_test' } },
    ...extra.platform,
  };
  validatePlatform(platform);
  return { platform, jurisdictions: new Map() };
}

/** A fully-specified profile. Real money is approved and configured; tests opt-in per scenario. */
export function profile(code, overrides = {}) {
  const base = {
    code,
    name: `Test ${code}`,
    locales: ['en'],
    default_locale: 'en',
    virtual: { enabled: true, categories: ['sports', 'casino'], restricted_games: [] },
    real_money: {
      legal_review: { status: 'approved', reference: `LR-${code}-1`, reviewed_at: '2029-01-01T00:00:00Z' },
      minimum_age: 18,
      permitted_categories: ['sports', 'casino'],
      currencies: ['GBP', 'EUR'],
      restricted_games: [],
      kyc: { deposit_level: 1, withdrawal_level: 2 },
      deposit: { methods: ['card'], min: { GBP: 500, EUR: 500 }, max_per_tx: { GBP: 100000, EUR: 100000 } },
      withdrawal: { methods: ['card'], min: { GBP: 100, EUR: 100 }, max_per_tx: { GBP: 500000, EUR: 500000 } },
      aml: {
        single_transaction_review: { GBP: 50000, EUR: 50000 },
        daily_review: { GBP: 200000, EUR: 200000 },
        reporting: { GBP: 100000, EUR: 100000 },
      },
      responsible_gambling: {
        required_tools: ['deposit_limits', 'self_exclusion'],
        reality_check_minutes: 60,
        cooling_off_hours: 24,
        max_daily_deposit: { GBP: 200000, EUR: 200000 },
        self_exclusion_min_days: 1,
      },
    },
    tax: { gaming_duty_bps: 1500, report_currency: 'GBP', report_period: 'monthly' },
  };
  const merged = deepMerge(base, overrides);
  // When a test narrows `currencies`, drop currency-keyed money maps that no longer apply.
  const cur = overrides.real_money?.currencies;
  if (cur) {
    const keep = (m) => Object.fromEntries(Object.entries(m ?? {}).filter(([k]) => cur.includes(k)));
    const rm = merged.real_money;
    rm.deposit.min = keep(rm.deposit.min); rm.deposit.max_per_tx = keep(rm.deposit.max_per_tx);
    rm.withdrawal.min = keep(rm.withdrawal.min); rm.withdrawal.max_per_tx = keep(rm.withdrawal.max_per_tx);
    rm.responsible_gambling.max_daily_deposit = keep(rm.responsible_gambling.max_daily_deposit);
    for (const k of Object.keys(rm.aml)) rm.aml[k] = keep(rm.aml[k]);
  }
  return merged;
}

function deepMerge(a, b) {
  if (b === undefined) return a;
  if (Array.isArray(b) || typeof b !== 'object' || b === null) return b;
  const out = { ...a };
  for (const k of Object.keys(b)) out[k] = deepMerge(a?.[k], b[k]);
  return out;
}

export function configWith(profiles = [], platformExtra = {}) {
  const cfg = testPlatformConfig(platformExtra);
  for (const p of profiles) {
    validateJurisdiction(p, `${p.code}.json`);
    cfg.jurisdictions.set(p.code, Object.freeze(p));
  }
  return cfg;
}

/** Test-only monetary provider. Records calls so tests can assert on them. */
export class FakeMonetaryProvider {
  constructor({ id = 'psp_test', depositStatus = 'pending', failWithdrawal = false } = {}) {
    this.id = id;
    this.monetary = true;
    this.depositStatus = depositStatus;
    this.failWithdrawal = failWithdrawal;
    this.withdrawals = [];
    this.deposits = [];
  }
  async createDeposit({ id, amountMinor, currency }) {
    this.deposits.push({ id, amountMinor, currency });
    return { providerRef: `ref_${id}`, status: this.depositStatus };
  }
  async requestWithdrawal({ id, amountMinor, currency }) {
    if (this.failWithdrawal) throw new Error('provider down');
    this.withdrawals.push({ id, amountMinor, currency });
    return { providerRef: `wd_${id}` };
  }
}

export function signWebhook(rawBody, secret = WEBHOOK_SECRET) {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

/**
 * Builds a platform for tests. Defaults to a fresh in-memory DB and the shipped
 * config. Pass `profiles` to use custom jurisdictions instead.
 */
export function makePlatform({ profiles = null, clock = new FakeClock(), rng = () => 0, providers = [], platformExtra = {}, webhookSecrets = { psp_test: WEBHOOK_SECRET } } = {}) {
  const config = profiles ? configWith(profiles, platformExtra) : loadConfig({ configDir: join(ROOT, 'config') });
  return createPlatform({
    config,
    configDir: join(ROOT, 'config'),
    clock,
    rng,
    adminToken: ADMIN_TOKEN,
    paymentProviders: providers,
    webhookSecrets,
  });
}

/** Opens a player with a given DOB/country and ensures virtual is switched on. */
export function openPlayer(platform, { username = 'player_one', country = 'GB', dateOfBirth = '1990-01-01', kycLevel = 0 } = {}) {
  const { accounts, ledger } = platform.services;
  const { token, user } = accounts.register({ username, password: 'correct-horse-1', displayName: username, country, dateOfBirth, locale: 'en' });
  if (kycLevel) platform.services.kyc.setLevel({ userId: user.id, level: kycLevel, actor: 'test' });
  return { token, user: accounts.getUser(user.id), ledger };
}

export function serve(platform) {
  return import('../src/api/http.js').then(async ({ createHandler }) => {
    const { createServer } = await import('node:http');
    const { buildRoutes } = await import('../src/api/routes.js');
    const handler = createHandler(platform, { routes: buildRoutes(), publicDir: join(ROOT, 'src', 'web', 'public') });
    const server = createServer(handler);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address();
    return { base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
  });
}
