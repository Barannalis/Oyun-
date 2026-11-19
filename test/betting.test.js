import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makePlatform, FakeClock, openPlayer, profile } from './helpers.js';

const setup = (clock = new FakeClock(), extra = {}) => {
  const p = makePlatform({ clock, ...extra });
  for (const c of p.config.jurisdictions.keys()) {
    p.services.engine.setOperations({ code: c, served: true, virtualEnabled: true, realEnabled: false, actor: 'test', now: clock.now() });
  }
  return p;
};
const events = (p, sport = 'football') => p.services.sportsbook.listOpen().filter((e) => e.sport === sport);
const VC_START = 1000000;

describe('virtual sportsbook', () => {
  test('a bet debits the wallet, records the potential payout, and keeps the ledger balanced', async () => {
    const clock = new FakeClock();
    const p = setup(clock);
    await p.services.admin.syncSports({ actor: 'test', provider: p.sportsProvider });
    const { user, ledger } = openPlayer(p, { country: 'GB' });
    const ev = events(p)[0];
    assert.equal(ev.odds.home, 21000);

    const bet = p.services.sportsbook.placeBet({ user, mode: 'virtual', currency: 'VC', eventId: ev.id, selection: 'home', stakeMinor: 1000 });
    assert.equal(bet.status, 'open');
    assert.equal(bet.potentialPayout, 2100);
    assert.equal(ledger.balance(`user:${user.id}`, 'virtual', 'VC'), VC_START - 1000);
    assert.equal(ledger.systemTotal('virtual', 'VC'), 0);
    p.close();
  });

  test('settlement pays a winner exactly once and marks losers, and the ledger stays balanced', async () => {
    const clock = new FakeClock();
    const p = setup(clock);
    await p.services.admin.syncSports({ actor: 'test', provider: p.sportsProvider });
    const win = openPlayer(p, { username: 'winner1', country: 'GB' });
    const lose = openPlayer(p, { username: 'loser01', country: 'GB' });
    const ev = events(p)[0];
    const wb = p.services.sportsbook.placeBet({ user: win.user, mode: 'virtual', currency: 'VC', eventId: ev.id, selection: 'home', stakeMinor: 1000 });
    const lb = p.services.sportsbook.placeBet({ user: lose.user, mode: 'virtual', currency: 'VC', eventId: ev.id, selection: 'away', stakeMinor: 500 });

    const res = p.services.sportsbook.settle({ eventId: ev.id, result: 'home', actor: 'admin:test' });
    assert.deepEqual(res, { settled: 2, winners: 1 });
    assert.equal(p.services.sportsbook.getBet(wb.id).status, 'won');
    assert.equal(p.services.sportsbook.getBet(wb.id).payout, 2100);
    assert.equal(p.services.sportsbook.getBet(lb.id).status, 'lost');
    assert.equal(win.ledger.balance(`user:${win.user.id}`, 'virtual', 'VC'), VC_START - 1000 + 2100);
    assert.equal(win.ledger.balance(`user:${lose.user.id}`, 'virtual', 'VC'), VC_START - 500);
    assert.equal(p.services.ledger.systemTotal('virtual', 'VC'), 0);

    assert.throws(() => p.services.sportsbook.settle({ eventId: ev.id, result: 'home', actor: 'admin:test' }), { code: 'event_already_settled' });
    p.close();
  });

  test('bets are refused once an event has started', async () => {
    const clock = new FakeClock();
    const p = setup(clock);
    await p.services.admin.syncSports({ actor: 'test', provider: p.sportsProvider });
    const { user } = openPlayer(p, { country: 'GB' });
    const ev = events(p)[0];
    clock.advance(49 * 3600000);
    assert.throws(() => p.services.sportsbook.placeBet({ user, mode: 'virtual', currency: 'VC', eventId: ev.id, selection: 'home', stakeMinor: 100 }), { code: 'event_closed' });
    p.close();
  });

  test('an event without a draw market rejects a draw selection', async () => {
    const p = setup();
    await p.services.admin.syncSports({ actor: 'test', provider: p.sportsProvider });
    const { user } = openPlayer(p, { country: 'GB' });
    const tennis = events(p, 'tennis')[0];
    assert.throws(() => p.services.sportsbook.placeBet({ user, mode: 'virtual', currency: 'VC', eventId: tennis.id, selection: 'draw', stakeMinor: 100 }), { code: 'invalid_selection' });
    p.close();
  });

  test('stakes outside the configured per-currency range are refused', async () => {
    const p = setup();
    await p.services.admin.syncSports({ actor: 'test', provider: p.sportsProvider });
    const { user } = openPlayer(p, { country: 'GB' });
    const ev = events(p)[0];
    assert.throws(() => p.services.sportsbook.placeBet({ user, mode: 'virtual', currency: 'VC', eventId: ev.id, selection: 'home', stakeMinor: 2000000 }), { code: 'stake_out_of_range' });
    assert.throws(() => p.services.sportsbook.placeBet({ user, mode: 'virtual', currency: 'VC', eventId: ev.id, selection: 'home', stakeMinor: 1 }), { code: 'stake_out_of_range' });
    p.close();
  });

  test('a real-money bet is refused with the jurisdiction reasons when real money is not open', async () => {
    const p = setup();
    await p.services.admin.syncSports({ actor: 'test', provider: p.sportsProvider });
    const { user } = openPlayer(p, { country: 'GB', kycLevel: 2 });
    const ev = events(p)[0];
    let err;
    try { p.services.sportsbook.placeBet({ user, mode: 'real', currency: 'GBP', eventId: ev.id, selection: 'home', stakeMinor: 1000 }); } catch (e) { err = e; }
    assert.equal(err?.code, 'forbidden');
    const codes = err.details.reasons.map((r) => r.code);
    for (const expected of ['real_money_disabled_by_operator', 'legal_review_pending', 'category_not_permitted', 'currency_not_allowed']) {
      assert.ok(codes.includes(expected), `expected ${expected} in ${codes}`);
    }
    p.close();
  });
});

describe('casino dice (virtual)', () => {
  test('a win pays stake * 99 / target and a loss pays nothing; ledger stays balanced', () => {
    const clock = new FakeClock();
    let next = 10;
    const p = makePlatform({ clock, rng: () => next });
    for (const c of p.config.jurisdictions.keys()) p.services.engine.setOperations({ code: c, served: true, virtualEnabled: true, realEnabled: false, actor: 't', now: clock.now() });
    const { user, ledger } = openPlayer(p, { country: 'GB' });

    const won = p.services.casino.play({ user, mode: 'virtual', currency: 'VC', gameId: 'dice', stakeMinor: 500, params: { target: 50 } });
    assert.equal(won.outcome.won, true);
    assert.equal(won.payout, 990);
    assert.equal(ledger.balance(`user:${user.id}`, 'virtual', 'VC'), VC_START - 500 + 990);

    next = 60;
    const lost = p.services.casino.play({ user, mode: 'virtual', currency: 'VC', gameId: 'dice', stakeMinor: 500, params: { target: 50 } });
    assert.equal(lost.outcome.won, false);
    assert.equal(lost.payout, 0);
    assert.equal(ledger.balance(`user:${user.id}`, 'virtual', 'VC'), VC_START - 1000 + 990);
    assert.equal(ledger.systemTotal('virtual', 'VC'), 0);
    p.close();
  });

  test('an invalid target is rejected before any money moves', () => {
    const p = makePlatform();
    for (const c of p.config.jurisdictions.keys()) p.services.engine.setOperations({ code: c, served: true, virtualEnabled: true, realEnabled: false, actor: 't', now: new Date() });
    const { user, ledger } = openPlayer(p, { country: 'GB' });
    assert.throws(() => p.services.casino.play({ user, mode: 'virtual', currency: 'VC', gameId: 'dice', stakeMinor: 500, params: { target: 1 } }), { code: 'invalid_target' });
    assert.equal(ledger.balance(`user:${user.id}`, 'virtual', 'VC'), VC_START);
    p.close();
  });

  test('a jurisdiction can restrict an individual game in virtual mode', () => {
    const clock = new FakeClock();
    const p = makePlatform({ clock, profiles: [profile('GB', { virtual: { restricted_games: ['game:dice'] } })] });
    p.services.engine.setOperations({ code: 'GB', served: true, virtualEnabled: true, realEnabled: false, actor: 't', now: clock.now() });
    const { user } = openPlayer(p, { country: 'GB' });
    assert.throws(() => p.services.casino.play({ user, mode: 'virtual', currency: 'VC', gameId: 'dice', stakeMinor: 500, params: { target: 50 } }), (e) => e.code === 'forbidden' && e.details.reasons[0].code === 'game_restricted');
    p.close();
  });
});

describe('reporting', () => {
  test('GGR is computed from settled activity, and tax is reported as not configured when no rate is set', async () => {
    const clock = new FakeClock();
    const p = setup(clock);
    await p.services.admin.syncSports({ actor: 'test', provider: p.sportsProvider });
    const { user } = openPlayer(p, { country: 'GB' });
    const ev = events(p)[0];
    p.services.sportsbook.placeBet({ user, mode: 'virtual', currency: 'VC', eventId: ev.id, selection: 'away', stakeMinor: 1000 });
    p.services.sportsbook.settle({ eventId: ev.id, result: 'home', actor: 'admin:test' });
    const from = new Date(clock.now().getTime() - 86400000).toISOString();
    const to = new Date(clock.now().getTime() + 86400000).toISOString();
    const report = p.services.reporting.jurisdictionReport({ code: 'GB', mode: 'virtual', from, to });
    assert.deepEqual(report.byCurrency.VC, { stakes: 1000, payouts: 0, ggr: 1000, bets: 1, rounds: 0 });
    assert.equal(report.tax.status, 'not_configured');
    p.close();
  });

  test('dashboard shows operator switches and license coverage per jurisdiction', () => {
    const p = setup();
    const board = p.services.reporting.dashboard();
    const gb = board.find((b) => b.jurisdiction === 'GB');
    assert.equal(gb.operations.served, true);
    assert.equal(gb.operations.realEnabled, false);
    assert.equal(gb.realMoneyGates.legalReview, 'pending');
    assert.equal(gb.realMoneyGates.licensedNow, false);
    p.close();
  });
});
