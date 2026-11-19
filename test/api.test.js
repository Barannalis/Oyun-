import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makePlatform, serve, ADMIN_TOKEN, FakeClock } from './helpers.js';

describe('HTTP API', () => {
  let platform;
  let server;
  const clock = new FakeClock();

  before(async () => {
    platform = makePlatform({ clock });
    server = await serve(platform);
  });
  after(async () => {
    await server.close();
    platform.close();
  });

  const call = async (method, path, { token, body, admin = false, headers = {} } = {}) => {
    const h = { ...headers };
    if (body !== undefined) h['content-type'] = 'application/json';
    if (token) h.authorization = `Bearer ${token}`;
    if (admin) h.authorization = `Bearer ${ADMIN_TOKEN}`;
    const res = await fetch(server.base + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* html or empty */ }
    return { status: res.status, json, text, headers: res.headers };
  };

  test('health and the static client are served', async () => {
    assert.equal((await call('GET', '/api/v1/health')).json.ok, true);
    const page = await call('GET', '/');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.equal((await call('GET', '/../../etc/passwd')).status, 404);
  });

  test('admin API rejects missing and wrong tokens, accepts the admin token', async () => {
    assert.equal((await call('GET', '/api/v1/admin/jurisdictions')).status, 401);
    assert.equal((await call('GET', '/api/v1/admin/jurisdictions', { token: 'wrong' })).status, 401);
    assert.equal((await call('GET', '/api/v1/admin/jurisdictions', { admin: true })).status, 200);
  });

  test('admin can switch a jurisdiction on; the change is audited', async () => {
    const r = await call('PUT', '/api/v1/admin/jurisdictions/GB/operations', {
      admin: true, headers: { 'x-actor': 'alice@ops' }, body: { served: true, virtualEnabled: true, realEnabled: false },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.served, true);
    const audit = platform.services.audit.list({ jurisdiction: 'GB' });
    assert.equal(audit[0].action, 'jurisdiction.operations_set');
    assert.equal(audit[0].actor, 'admin:alice@ops');
  });

  test('admin sports sync loads the schedule', async () => {
    const r = await call('POST', '/api/v1/admin/sports/sync', { admin: true });
    assert.equal(r.status, 200);
    assert.equal(r.json.result.upserted, 3);
  });

  test('a country that is not served cannot open an account; the reason is returned', async () => {
    const r = await call('POST', '/api/v1/auth/register', { body: { username: 'nope_user', password: 'correct-horse-1', displayName: 'N', country: 'DE', dateOfBirth: '1990-01-01', locale: 'en' } });
    assert.equal(r.status, 403);
    assert.equal(r.json.error.code, 'forbidden');
    assert.equal(r.json.error.details.reasons[0].code, 'country_not_served');
    assert.match(r.json.error.details.reasons[0].message, /not currently offered/);
  });

  test('register, me, virtual bet, and dice all work for a player', async () => {
    const reg = await call('POST', '/api/v1/auth/register', { body: { username: 'api_player', password: 'correct-horse-1', displayName: 'Api', country: 'GB', dateOfBirth: '1990-01-01', locale: 'en' } });
    assert.equal(reg.status, 201);
    const token = reg.json.token;
    assert.ok(token.length > 30);
    assert.equal(reg.json.user.password, undefined);

    const me = await call('GET', '/api/v1/me', { token });
    assert.equal(me.status, 200);
    const vc = me.json.wallets.find((w) => w.mode === 'virtual').balances[0];
    assert.equal(vc.currency, 'VC');
    assert.equal(vc.amountMinor, 1000000);
    assert.equal(me.json.availability.virtual.sports.allowed, true);
    assert.equal(me.json.availability.real.sports.allowed, false);

    const events = await call('GET', '/api/v1/sports/events', { token });
    const ev = events.json.events[0];
    const bet = await call('POST', '/api/v1/bets', { token, body: { eventId: ev.id, selection: 'home', stake: '10.00', mode: 'virtual' } });
    assert.equal(bet.status, 201);
    assert.equal(bet.json.bet.stake, 1000);

    const dice = await call('POST', '/api/v1/casino/games/dice/play', { token, body: { stake: '5', mode: 'virtual', params: { target: 49 } } });
    assert.equal(dice.status, 201);
    assert.equal(dice.json.round.currency, 'VC');
    assert.equal(typeof dice.json.round.outcome.roll, 'number');
  });

  test('a real-money deposit is refused with reasons, and the response is localized to the requested language', async () => {
    const reg = await call('POST', '/api/v1/auth/register', { body: { username: 'fr_player', password: 'correct-horse-1', displayName: 'Fr', country: 'GB', dateOfBirth: '1990-01-01', locale: 'fr' } });
    const token = reg.json.token;
    const r = await call('POST', '/api/v1/wallet/deposits', { token, headers: { 'accept-language': 'fr-FR,fr;q=0.9' }, body: { currency: 'GBP', amount: '10', method: 'card' } });
    assert.equal(r.status, 403);
    const codes = r.json.error.details.reasons.map((x) => x.code);
    assert.ok(codes.includes('payment_method_unavailable'));
    assert.ok(codes.includes('legal_review_pending') || codes.includes('no_active_license'));
    assert.match(r.json.error.details.reasons[0].message, /[éèàùâêîôû]|pas|est|une|votre/i);
  });

  test('duplicate usernames return a 409 with a localized message', async () => {
    const r = await call('POST', '/api/v1/auth/register', { headers: { 'accept-language': 'fr' }, body: { username: 'API_PLAYER', password: 'correct-horse-1', displayName: 'X', country: 'GB', dateOfBirth: '1990-01-01' } });
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, 'username_taken');
    assert.match(r.json.error.message, /utilisé/);
  });

  test('wrong password and unknown user return the same error', async () => {
    const a = await call('POST', '/api/v1/auth/login', { body: { username: 'api_player', password: 'wrong-password-x' } });
    const b = await call('POST', '/api/v1/auth/login', { body: { username: 'nobody_here', password: 'wrong-password-x' } });
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    assert.equal(a.json.error.code, b.json.error.code);
  });

  test('player routes need a valid session; logout revokes it', async () => {
    assert.equal((await call('GET', '/api/v1/me')).status, 401);
    const login = await call('POST', '/api/v1/auth/login', { body: { username: 'api_player', password: 'correct-horse-1' } });
    assert.equal((await call('GET', '/api/v1/me', { token: login.json.token })).status, 200);
    await call('POST', '/api/v1/auth/logout', { token: login.json.token });
    assert.equal((await call('GET', '/api/v1/me', { token: login.json.token })).status, 401);
  });

  test('webhooks require a valid signature', async () => {
    const r = await call('POST', '/api/v1/webhooks/payments/psp_test', { body: { type: 'deposit.completed', id: 'x' } });
    assert.equal(r.status, 401);
  });

  test('malformed JSON and oversized bodies are rejected cleanly', async () => {
    const bad = await fetch(server.base + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' });
    assert.equal(bad.status, 400);
    const big = await fetch(server.base + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ x: 'a'.repeat(70000) }) });
    assert.equal(big.status, 400);
  });

  test('error responses never leak stack traces or internal messages', async () => {
    const r = await call('GET', '/api/v1/casino/games/does-not-exist/nothing');
    assert.equal(r.status, 404);
    assert.ok(!r.text.includes('at '), 'no stack frames');
  });

  test('the admin dashboard reports every jurisdiction with real money closed', async () => {
    const r = await call('GET', '/api/v1/admin/dashboard', { admin: true });
    assert.equal(r.status, 200);
    assert.equal(r.json.jurisdictions.length, 3);
    const gb = r.json.jurisdictions.find((j) => j.jurisdiction === 'GB');
    assert.equal(gb.operations.realEnabled, false);
    assert.equal(gb.realMoneyGates.legalReview, 'pending');
  });

  test('the public countries list shows only served countries', async () => {
    const r = await call('GET', '/api/v1/countries');
    assert.deepEqual(r.json.map((c) => c.code), ['GB']);
  });

  test('the i18n catalog endpoint serves a locale and falls back to English for unknown tags', async () => {
    const fr = await call('GET', '/api/v1/i18n/fr');
    assert.equal(fr.json.locale, 'fr');
    assert.ok(fr.json.messages['ui.login']);
    const unknown = await call('GET', '/api/v1/i18n/xx');
    assert.equal(unknown.json.locale, 'en');
  });
});
