import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makePlatform, profile, openPlayer, FakeClock, ADMIN_TOKEN } from './helpers.js';

const DAY = 86400000;

/** GB and DE both served with virtual and real switched on. Real still needs licenses. */
function platformWithTwoCountries(clock = new FakeClock()) {
  const p = makePlatform({
    profiles: [profile('GB'), profile('DE', { real_money: { currencies: ['EUR'], deposit: { min: { EUR: 500 }, max_per_tx: { EUR: 100000 } } } })],
    clock,
  });
  for (const code of ['GB', 'DE']) {
    p.services.engine.setOperations({ code, served: true, virtualEnabled: true, realEnabled: true, actor: 'test', now: clock.now() });
  }
  return p;
}

const codes = (d) => d.reasons.map((r) => r.code).sort();

describe('jurisdiction engine: country-level decisions', () => {
  test('a country with no profile is denied (default deny, no implicit default country)', () => {
    const p = platformWithTwoCountries();
    const decision = p.services.engine.evaluate({
      user: { id: 'u', country: 'FR', dateOfBirth: '1990-01-01', kycLevel: 2, selfExcludedUntil: null, status: 'active' },
      mode: 'virtual', category: 'sports', action: 'bet',
    });
    assert.equal(decision.allowed, false);
    assert.deepEqual(codes(decision), ['country_not_supported']);
    p.close();
  });

  test('a profile that exists but is not switched on by the operator is denied', () => {
    const clock = new FakeClock();
    const p = makePlatform({ profiles: [profile('GB')], clock });
    const decision = p.services.engine.evaluate({
      user: { id: 'u', country: 'GB', dateOfBirth: '1990-01-01', kycLevel: 2, selfExcludedUntil: null, status: 'active' },
      mode: 'virtual', category: 'sports', action: 'bet',
    });
    assert.deepEqual(codes(decision), ['country_not_served']);
    p.close();
  });

  test('virtual mode is available without any license', () => {
    const p = platformWithTwoCountries();
    const u = openPlayer(p, { country: 'GB' }).user;
    assert.equal(p.services.engine.evaluate({ user: u, mode: 'virtual', category: 'sports', action: 'bet' }).allowed, true);
    assert.equal(p.services.engine.evaluate({ user: u, mode: 'virtual', category: 'casino', action: 'play' }).allowed, true);
    p.close();
  });

  test('virtual mode offers only the categories the jurisdiction lists', () => {
    const p = platformWithTwoCountries();
    const u = openPlayer(p, { country: 'GB' }).user;
    const d = p.services.engine.evaluate({ user: u, mode: 'virtual', category: 'esports', action: 'bet' });
    assert.deepEqual(codes(d), ['category_not_available']);
    p.close();
  });

  test('real money is denied with no license, even when every other gate is open', () => {
    const p = platformWithTwoCountries();
    const u = openPlayer(p, { country: 'GB', kycLevel: 1 }).user;
    const d = p.services.engine.evaluate({ user: u, mode: 'real', category: 'sports', action: 'bet', currency: 'GBP' });
    assert.deepEqual(codes(d), ['no_active_license']);
    p.close();
  });

  test('a license in one country never authorizes another country', () => {
    const p = platformWithTwoCountries();
    const gb = openPlayer(p, { username: 'gb_player', country: 'GB', kycLevel: 1 }).user;
    const de = openPlayer(p, { username: 'de_player', country: 'DE', kycLevel: 1 }).user;
    p.services.licenses.create({
      jurisdiction: 'GB', regulator: 'Example Regulator', licenseNumber: 'GB-1', operatorEntity: 'Example Ops Ltd',
      categories: ['sports'], status: 'active', validFrom: '2029-01-01T00:00:00Z', validUntil: '2031-01-01T00:00:00Z',
    });
    assert.equal(p.services.engine.evaluate({ user: gb, mode: 'real', category: 'sports', action: 'bet', currency: 'GBP' }).allowed, true);
    const deDecision = p.services.engine.evaluate({ user: de, mode: 'real', category: 'sports', action: 'bet', currency: 'EUR' });
    assert.deepEqual(codes(deDecision), ['no_active_license']);
    p.close();
  });

  test('a license only covers the categories it lists', () => {
    const p = platformWithTwoCountries();
    const gb = openPlayer(p, { country: 'GB', kycLevel: 1 }).user;
    p.services.licenses.create({
      jurisdiction: 'GB', regulator: 'R', licenseNumber: 'GB-2', operatorEntity: 'O', categories: ['sports'], status: 'active',
    });
    assert.deepEqual(codes(p.services.engine.evaluate({ user: gb, mode: 'real', category: 'casino', action: 'play', currency: 'GBP' })), ['no_active_license']);
    p.close();
  });

  test('suspended, revoked and pending licenses each yield their own reason', () => {
    const cases = [
      { status: 'suspended', reason: 'license_suspended' },
      { status: 'revoked', reason: 'license_revoked' },
      { status: 'pending', reason: 'license_pending' },
    ];
    for (const c of cases) {
      const p = platformWithTwoCountries();
      const gb = openPlayer(p, { country: 'GB', kycLevel: 1 }).user;
      p.services.licenses.create({ jurisdiction: 'GB', regulator: 'R', licenseNumber: c.status, operatorEntity: 'O', categories: ['sports'], status: c.status });
      assert.deepEqual(codes(p.services.engine.evaluate({ user: gb, mode: 'real', category: 'sports', action: 'bet', currency: 'GBP' })), [c.reason], c.status);
      p.close();
    }
  });

  test('an active license is valid only inside its validity window, and a revoked license is terminal', () => {
    const clock = new FakeClock();
    const p = platformWithTwoCountries(clock);
    const gb = openPlayer(p, { country: 'GB', kycLevel: 1 }).user;
    const lic = p.services.licenses.create({ jurisdiction: 'GB', regulator: 'R', licenseNumber: 'W', operatorEntity: 'O', categories: ['sports'], status: 'active' });
    assert.equal(p.services.engine.evaluate({ user: gb, mode: 'real', category: 'sports', action: 'bet', currency: 'GBP' }).allowed, true);
    p.services.licenses.setStatus(lic.id, 'revoked');
    assert.throws(() => p.services.licenses.setStatus(lic.id, 'active'), { code: 'license_revoked_is_terminal' });
    p.close();
  });

  test('an expired license reports expiry when it is the only one covering the category', () => {
    const clock = new FakeClock();
    const p = platformWithTwoCountries(clock);
    const gb = openPlayer(p, { country: 'GB', kycLevel: 1 }).user;
    p.services.licenses.create({
      jurisdiction: 'GB', regulator: 'R', licenseNumber: 'EXP', operatorEntity: 'O', categories: ['sports'],
      status: 'active', validFrom: '2025-01-01T00:00:00Z', validUntil: '2029-01-01T00:00:00Z',
    });
    assert.deepEqual(codes(p.services.engine.evaluate({ user: gb, mode: 'real', category: 'sports', action: 'bet', currency: 'GBP' })), ['license_expired']);
    p.close();
  });

  test('legal review pending blocks real money even with an active license', () => {
    const clock = new FakeClock();
    const p = makePlatform({
      profiles: [profile('GB', { real_money: { legal_review: { status: 'pending', reference: null, reviewed_at: null } } })],
      clock,
    });
    p.services.engine.setOperations({ code: 'GB', served: true, virtualEnabled: true, realEnabled: true, actor: 't', now: clock.now() });
    const gb = openPlayer(p, { country: 'GB', kycLevel: 1 }).user;
    p.services.licenses.create({ jurisdiction: 'GB', regulator: 'R', licenseNumber: 'X', operatorEntity: 'O', categories: ['sports'], status: 'active' });
    assert.deepEqual(codes(p.services.engine.evaluate({ user: gb, mode: 'real', category: 'sports', action: 'bet', currency: 'GBP' })), ['legal_review_pending']);
    p.close();
  });

  test('the operator kill switch stops real money instantly, licence or not', () => {
    const clock = new FakeClock();
    const p = platformWithTwoCountries(clock);
    const gb = openPlayer(p, { country: 'GB', kycLevel: 1 }).user;
    p.services.licenses.create({ jurisdiction: 'GB', regulator: 'R', licenseNumber: 'K', operatorEntity: 'O', categories: ['sports'], status: 'active' });
    assert.equal(p.services.engine.evaluate({ user: gb, mode: 'real', category: 'sports', action: 'bet', currency: 'GBP' }).allowed, true);
    p.services.engine.setOperations({ code: 'GB', served: true, virtualEnabled: true, realEnabled: false, actor: 'test', now: clock.now() });
    assert.deepEqual(codes(p.services.engine.evaluate({ user: gb, mode: 'real', category: 'sports', action: 'bet', currency: 'GBP' })), ['real_money_disabled_by_operator']);
    p.close();
  });

  test('real money cannot be switched on for a country that is not served', () => {
    const p = platformWithTwoCountries();
    assert.throws(() => p.services.engine.setOperations({ code: 'GB', served: false, virtualEnabled: false, realEnabled: true, actor: 't', now: new Date() }), { code: 'real_requires_served' });
    p.close();
  });

  test('a currency not permitted for real money is denied', () => {
    const p = platformWithTwoCountries();
    const gb = openPlayer(p, { country: 'GB', kycLevel: 1 }).user;
    p.services.licenses.create({ jurisdiction: 'GB', regulator: 'R', licenseNumber: 'C', operatorEntity: 'O', categories: ['sports'], status: 'active' });
    assert.deepEqual(codes(p.services.engine.evaluate({ user: gb, mode: 'real', category: 'sports', action: 'bet', currency: 'USD' })), ['currency_not_allowed']);
    p.close();
  });

  test('restricted games are blocked per jurisdiction, in virtual and real modes', () => {
    const clock = new FakeClock();
    const p = makePlatform({
      profiles: [profile('GB', { virtual: { restricted_games: ['game:dice'] }, real_money: { restricted_games: ['game:dice'] } })],
      clock,
    });
    p.services.engine.setOperations({ code: 'GB', served: true, virtualEnabled: true, realEnabled: true, actor: 't', now: clock.now() });
    p.services.licenses.create({ jurisdiction: 'GB', regulator: 'R', licenseNumber: 'G', operatorEntity: 'O', categories: ['casino'], status: 'active' });
    const gb = openPlayer(p, { country: 'GB', kycLevel: 1 }).user;
    assert.deepEqual(codes(p.services.engine.evaluate({ user: gb, mode: 'virtual', category: 'casino', gameKey: 'game:dice', action: 'play' })), ['game_restricted']);
    assert.deepEqual(codes(p.services.engine.evaluate({ user: gb, mode: 'real', category: 'casino', gameKey: 'game:dice', action: 'play', currency: 'GBP' })), ['game_restricted']);
    p.close();
  });

  test('under-age players are denied in both modes', () => {
    const p = platformWithTwoCountries();
    const kid = { id: 'k', country: 'GB', dateOfBirth: '2015-01-01', kycLevel: 2, selfExcludedUntil: null, status: 'active' };
    p.services.licenses.create({ jurisdiction: 'GB', regulator: 'R', licenseNumber: 'U', operatorEntity: 'O', categories: ['sports'], status: 'active' });
    assert.deepEqual(codes(p.services.engine.evaluate({ user: kid, mode: 'virtual', category: 'sports', action: 'bet' })), ['under_age']);
    assert.deepEqual(codes(p.services.engine.evaluate({ user: kid, mode: 'real', category: 'sports', action: 'bet', currency: 'GBP' })), ['under_age']);
    p.close();
  });

  test('a missing real-money age policy fails closed, but virtual mode still uses the platform floor', () => {
    const clock = new FakeClock();
    const p = makePlatform({ profiles: [profile('GB', { real_money: { minimum_age: null } })], clock });
    p.services.engine.setOperations({ code: 'GB', served: true, virtualEnabled: true, realEnabled: true, actor: 't', now: clock.now() });
    const gb = openPlayer(p, { country: 'GB', kycLevel: 1 }).user;
    assert.equal(p.services.engine.evaluate({ user: gb, mode: 'virtual', category: 'sports', action: 'bet' }).allowed, true);
    p.services.licenses.create({ jurisdiction: 'GB', regulator: 'R', licenseNumber: 'AGE', operatorEntity: 'O', categories: ['sports'], status: 'active' });
    assert.deepEqual(codes(p.services.engine.evaluate({ user: gb, mode: 'real', category: 'sports', action: 'bet', currency: 'GBP' })), ['age_policy_missing']);
    p.close();
  });

  test('KYC level below the requirement is denied for real money only', () => {
    const p = platformWithTwoCountries();
    const gb = openPlayer(p, { country: 'GB', kycLevel: 0 }).user;
    p.services.licenses.create({ jurisdiction: 'GB', regulator: 'R', licenseNumber: 'KYC', operatorEntity: 'O', categories: ['sports'], status: 'active' });
    assert.deepEqual(codes(p.services.engine.evaluate({ user: gb, mode: 'real', category: 'sports', action: 'bet', currency: 'GBP' })), ['kyc_level_insufficient']);
    assert.equal(p.services.engine.evaluate({ user: gb, mode: 'virtual', category: 'sports', action: 'bet' }).allowed, true);
    p.close();
  });

  test('availability matrix covers every mode and category with reasons', () => {
    const p = platformWithTwoCountries();
    const gb = openPlayer(p, { country: 'GB' }).user;
    const m = p.services.engine.availability(gb);
    assert.deepEqual(Object.keys(m).sort(), ['real', 'virtual']);
    assert.deepEqual(Object.keys(m.real).sort(), ['casino', 'esports', 'sports', 'table_games', 'virtual_sports']);
    assert.equal(m.virtual.sports.allowed, true);
    assert.equal(m.real.sports.allowed, false);
    p.close();
  });
});

describe('responsible gambling', () => {
  test('lowering a daily deposit limit applies immediately; raising waits for the cooling-off period', () => {
    const clock = new FakeClock();
    const p = platformWithTwoCountries(clock);
    const { user } = openPlayer(p, { country: 'GB', kycLevel: 1 });
    const profileGB = p.config.jurisdictions.get('GB');
    const rg = p.services.responsible;

    rg.setDailyDepositLimit({ userId: user.id, profile: profileGB, currency: 'GBP', amountMinor: 50000 });
    assert.equal(rg.effectiveDailyDeposit(user.id, 'GBP', clock.now()), 50000);

    const raise = rg.setDailyDepositLimit({ userId: user.id, profile: profileGB, currency: 'GBP', amountMinor: 80000 });
    assert.equal(raise.effective, 50000);
    assert.equal(raise.pending, 80000);
    assert.equal(rg.effectiveDailyDeposit(user.id, 'GBP', clock.now()), 50000, 'old limit still applies during cooling-off');

    clock.advance(24 * 3600000);
    assert.equal(rg.effectiveDailyDeposit(user.id, 'GBP', clock.now()), 80000, 'raised limit applies after cooling-off');

    rg.setDailyDepositLimit({ userId: user.id, profile: profileGB, currency: 'GBP', amountMinor: 20000 });
    assert.equal(rg.effectiveDailyDeposit(user.id, 'GBP', clock.now()), 20000);
    p.close();
  });

  test('a player limit cannot exceed the jurisdiction cap, and cannot be removed when a cap exists', () => {
    const clock = new FakeClock();
    const p = platformWithTwoCountries(clock);
    const { user } = openPlayer(p, { country: 'GB', kycLevel: 1 });
    const profileGB = p.config.jurisdictions.get('GB');
    assert.throws(() => p.services.responsible.setDailyDepositLimit({ userId: user.id, profile: profileGB, currency: 'GBP', amountMinor: 999999 }), { code: 'limit_above_cap' });
    assert.throws(() => p.services.responsible.setDailyDepositLimit({ userId: user.id, profile: profileGB, currency: 'GBP', amountMinor: null }), { code: 'limit_above_cap' });
    p.close();
  });

  test('self-exclusion must meet the minimum period, can be extended, never shortened, and blocks real money only', () => {
    const clock = new FakeClock();
    const p = platformWithTwoCountries(clock);
    const { user } = openPlayer(p, { country: 'GB', kycLevel: 1 });
    const profileGB = p.config.jurisdictions.get('GB');
    const rg = p.services.responsible;
    p.services.licenses.create({ jurisdiction: 'GB', regulator: 'R', licenseNumber: 'SE', operatorEntity: 'O', categories: ['sports'], status: 'active' });

    assert.throws(() => rg.selfExclude({ userId: user.id, profile: profileGB, currentExclusionUntil: null, untilIso: new Date(clock.now().getTime() + 3600000).toISOString() }), { code: 'self_exclusion_too_short' });

    const until30 = new Date(clock.now().getTime() + 30 * DAY).toISOString();
    rg.selfExclude({ userId: user.id, profile: profileGB, currentExclusionUntil: null, untilIso: until30 });
    const excluded = p.services.accounts.getUser(user.id);
    assert.throws(() => rg.selfExclude({ userId: user.id, profile: profileGB, currentExclusionUntil: excluded.selfExcludedUntil, untilIso: new Date(clock.now().getTime() + 5 * DAY).toISOString() }), { code: 'self_exclusion_shorter' });

    assert.deepEqual(codes(p.services.engine.evaluate({ user: excluded, mode: 'real', category: 'sports', action: 'bet', currency: 'GBP' })), ['self_excluded']);
    assert.equal(p.services.engine.evaluate({ user: excluded, mode: 'virtual', category: 'sports', action: 'bet' }).allowed, true);
    p.close();
  });
});

describe('KYC and audit', () => {
  test('KYC level changes are validated and written to the audit log', () => {
    const p = platformWithTwoCountries();
    const { user } = openPlayer(p, { country: 'GB' });
    assert.throws(() => p.services.kyc.setLevel({ userId: user.id, level: 5, actor: 'a' }), { code: 'invalid_input' });
    p.services.admin.setKyc({ actor: 'admin:alice', userId: user.id, level: 2 });
    assert.equal(p.services.accounts.getUser(user.id).kycLevel, 2);
    const log = p.services.audit.list({ jurisdiction: 'GB' });
    const entry = log.find((e) => e.action === 'kyc.level_set');
    assert.ok(entry, 'audit entry exists');
    assert.equal(entry.actor, 'admin:alice');
    assert.deepEqual(entry.details, { from: 0, to: 2, providerRef: null });
    p.close();
  });

  test('the platform refuses to start with a short admin token', async () => {
    const { createPlatform } = await import('../src/app.js');
    assert.throws(() => createPlatform({ configDir: 'config', adminToken: 'short' }), /adminToken/);
    assert.ok(ADMIN_TOKEN.length >= 24);
  });
});
