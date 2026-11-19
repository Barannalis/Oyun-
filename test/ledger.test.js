import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makePlatform, FakeClock } from './helpers.js';
import { owners } from '../src/core/domain.js';

describe('double-entry ledger', () => {
  const setup = () => {
    const p = makePlatform({ clock: new FakeClock() });
    return { p, ledger: p.services.ledger };
  };

  test('a balanced transaction moves value and keeps the system total at zero', () => {
    const { p, ledger } = setup();
    ledger.post({ type: 't', mode: 'virtual', currency: 'VC', legs: [
      { owner: owners.grants, amount: -500 },
      { owner: 'user:a', amount: 500 },
    ] });
    assert.equal(ledger.balance('user:a', 'virtual', 'VC'), 500);
    assert.equal(ledger.systemTotal('virtual', 'VC'), 0);
    p.close();
  });

  test('unbalanced legs are rejected', () => {
    const { p, ledger } = setup();
    assert.throws(() => ledger.post({ type: 't', mode: 'virtual', currency: 'VC', legs: [
      { owner: owners.grants, amount: -500 },
      { owner: 'user:a', amount: 400 },
    ] }), { code: 'ledger_unbalanced' });
    p.close();
  });

  test('virtual mode only accepts VC and real mode never accepts VC', () => {
    const { p, ledger } = setup();
    const legs = [{ owner: 'user:a', amount: 1 }, { owner: owners.grants, amount: -1 }];
    assert.throws(() => ledger.post({ type: 't', mode: 'virtual', currency: 'GBP', legs }), { code: 'virtual_mode_requires_virtual_currency' });
    assert.throws(() => ledger.post({ type: 't', mode: 'real', currency: 'VC', legs }), { code: 'real_mode_forbids_virtual_currency' });
    p.close();
  });

  test('user wallets cannot go negative, and a failed post leaves no partial writes', () => {
    const { p, ledger } = setup();
    ledger.post({ type: 't', mode: 'virtual', currency: 'VC', legs: [{ owner: owners.grants, amount: -100 }, { owner: 'user:a', amount: 100 }] });
    assert.throws(() => ledger.post({ type: 't', mode: 'virtual', currency: 'VC', legs: [
      { owner: 'user:a', amount: -150 },
      { owner: owners.house('virtual'), amount: 150 },
    ] }), { code: 'insufficient_funds' });
    assert.equal(ledger.balance('user:a', 'virtual', 'VC'), 100);
    assert.equal(ledger.systemTotal('virtual', 'VC'), 0);
    p.close();
  });

  test('system counterparty wallets may go negative', () => {
    const { p, ledger } = setup();
    ledger.post({ type: 't', mode: 'virtual', currency: 'VC', legs: [{ owner: owners.grants, amount: -1000 }, { owner: 'user:a', amount: 1000 }] });
    assert.equal(ledger.balance(owners.grants, 'virtual', 'VC'), -1000);
    p.close();
  });

  test('an idempotency key posts at most once', () => {
    const { p, ledger } = setup();
    const tx = { type: 't', mode: 'virtual', currency: 'VC', idempotencyKey: 'k1', legs: [{ owner: owners.grants, amount: -10 }, { owner: 'user:a', amount: 10 }] };
    const first = ledger.post(tx);
    const second = ledger.post(tx);
    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    assert.equal(second.id, first.id);
    assert.equal(ledger.balance('user:a', 'virtual', 'VC'), 10);
    p.close();
  });

  test('a surrounding transaction rolls back nested posts on error', () => {
    const { p, ledger } = setup();
    ledger.post({ type: 't', mode: 'virtual', currency: 'VC', legs: [{ owner: owners.grants, amount: -100 }, { owner: 'user:a', amount: 100 }] });
    assert.throws(() => p.db.transaction(() => {
      ledger.post({ type: 't', mode: 'virtual', currency: 'VC', legs: [{ owner: 'user:a', amount: -40 }, { owner: owners.house('virtual'), amount: 40 }] });
      throw new Error('boom');
    }), /boom/);
    assert.equal(ledger.balance('user:a', 'virtual', 'VC'), 100);
    assert.equal(ledger.systemTotal('virtual', 'VC'), 0);
    p.close();
  });

  test('legs for the same owner are netted, and a zero-net post records nothing', () => {
    const { p, ledger } = setup();
    ledger.post({ type: 't', mode: 'virtual', currency: 'VC', legs: [{ owner: owners.grants, amount: -100 }, { owner: 'user:a', amount: 100 }] });
    const res = ledger.post({ type: 't', mode: 'virtual', currency: 'VC', legs: [
      { owner: 'user:a', amount: -50 },
      { owner: 'user:a', amount: 50 },
    ] });
    assert.equal(res.id, null);
    assert.equal(ledger.balance('user:a', 'virtual', 'VC'), 100);
    p.close();
  });
});
