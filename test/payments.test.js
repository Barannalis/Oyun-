import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makePlatform, FakeClock, FakeMonetaryProvider, openPlayer, profile, signWebhook, WEBHOOK_SECRET } from './helpers.js';
import { owners } from '../src/core/domain.js';

/** Real-money-enabled GB with a license, a monetary provider behind the "card" method, and KYC 1. */
function realSetup({ provider = new FakeMonetaryProvider(), profileOverrides = {}, licenseCategories = ['sports', 'casino'] } = {}) {
  const clock = new FakeClock();
  const p = makePlatform({
    clock,
    profiles: [profile('GB', profileOverrides)],
    providers: [provider],
  });
  p.services.engine.setOperations({ code: 'GB', served: true, virtualEnabled: true, realEnabled: true, actor: 'test', now: clock.now() });
  p.services.licenses.create({ jurisdiction: 'GB', regulator: 'Example Regulator', licenseNumber: 'GB-LIC-1', operatorEntity: 'Example Ops Ltd', categories: licenseCategories, status: 'active' });
  // KYC 2 satisfies both the deposit (1) and withdrawal (2) requirements of the test profile.
  const { user } = openPlayer(p, { country: 'GB', kycLevel: 2 });
  return { p, clock, user, provider, ledger: p.services.ledger };
}

const realBal = (ledger, user, cur = 'GBP') => ledger.balance(owners.user(user.id), 'real', cur);
const webhook = (p, body) => {
  const raw = JSON.stringify(body);
  return p.services.payments.handleWebhook({ provider: 'psp_test', rawBody: raw, signature: signWebhook(raw) });
};

describe('real-money deposits', () => {
  test('a deposit is refused without an active license, and no payment row is created', async () => {
    const clock = new FakeClock();
    const p = makePlatform({ clock, profiles: [profile('GB')], providers: [new FakeMonetaryProvider()] });
    p.services.engine.setOperations({ code: 'GB', served: true, virtualEnabled: true, realEnabled: true, actor: 'test', now: clock.now() });
    const { user } = openPlayer(p, { country: 'GB', kycLevel: 1 });
    await assert.rejects(
      p.services.payments.requestDeposit({ user, mode: 'real', method: 'card', currency: 'GBP', amountMinor: 10000 }),
      (e) => e.code === 'forbidden' && e.details.reasons.some((r) => r.code === 'no_active_license'),
    );
    assert.equal(p.services.payments.listForUser(user.id).length, 0);
    p.close();
  });

  test('a deposit with a live provider is credited only when the signed webhook confirms it, and never twice', async () => {
    const { p, user, ledger } = realSetup();
    const dep = await p.services.payments.requestDeposit({ user, mode: 'real', method: 'card', currency: 'GBP', amountMinor: 10000 });
    assert.equal(dep.status, 'pending');
    assert.equal(realBal(ledger, user), 0, 'not credited while pending');

    webhook(p, { type: 'deposit.completed', id: dep.id });
    assert.equal(realBal(ledger, user), 10000);
    assert.equal(ledger.systemTotal('real', 'GBP'), 0);

    webhook(p, { type: 'deposit.completed', id: dep.id });
    assert.equal(realBal(ledger, user), 10000, 'replayed webhook does not double-credit');
    p.close();
  });

  test('webhooks without a valid signature are rejected', async () => {
    const { p, user } = realSetup();
    const dep = await p.services.payments.requestDeposit({ user, mode: 'real', method: 'card', currency: 'GBP', amountMinor: 10000 });
    const raw = JSON.stringify({ type: 'deposit.completed', id: dep.id });
    assert.throws(() => p.services.payments.handleWebhook({ provider: 'psp_test', rawBody: raw, signature: 'deadbeef' }), { code: 'webhook_signature_invalid' });
    assert.throws(() => p.services.payments.handleWebhook({ provider: 'psp_test', rawBody: raw, signature: signWebhook(raw, 'wrong-secret-0000000000000') }), { code: 'webhook_signature_invalid' });
    assert.throws(() => p.services.payments.handleWebhook({ provider: 'psp_test', rawBody: raw, signature: undefined }), { code: 'webhook_signature_invalid' });
    assert.equal(p.services.payments.getPayment(dep.id).status, 'pending');
    p.close();
  });

  test('min, max, method and daily limit are enforced', async () => {
    const { p, user } = realSetup();
    const attempt = (amountMinor, method = 'card') => p.services.payments.requestDeposit({ user, mode: 'real', method, currency: 'GBP', amountMinor });
    await assert.rejects(attempt(499), (e) => e.details.reasons[0].code === 'amount_below_minimum');
    await assert.rejects(attempt(100001), (e) => e.details.reasons[0].code === 'amount_above_maximum');
    await assert.rejects(attempt(10000, 'bank_transfer'), (e) => e.details.reasons[0].code === 'payment_method_unavailable');
    p.services.responsible.setDailyDepositLimit({ userId: user.id, profile: p.config.jurisdictions.get('GB'), currency: 'GBP', amountMinor: 15000 });
    await attempt(10000);
    await assert.rejects(attempt(10000), (e) => e.details.reasons.some((r) => r.code === 'daily_deposit_limit_exceeded'));
    p.close();
  });

  test('deposits are not a virtual-mode function', async () => {
    const { p, user } = realSetup();
    await assert.rejects(p.services.payments.requestDeposit({ user, mode: 'virtual', method: 'card', currency: 'VC', amountMinor: 100 }), { code: 'deposits_real_mode_only' });
    p.close();
  });

  test('a non-monetary provider cannot be registered to move real money', () => {
    const { p } = realSetup();
    assert.throws(() => p.services.payments.registerProvider({ id: 'sandbox', monetary: false }), { code: 'non_monetary_provider' });
    p.close();
  });

  test('a deposit above the review threshold credits the player but opens an AML review alert', async () => {
    const { p, user, ledger } = realSetup();
    const dep = await p.services.payments.requestDeposit({ user, mode: 'real', method: 'card', currency: 'GBP', amountMinor: 60000 });
    p.services.responsible.setDailyDepositLimit({ userId: user.id, profile: p.config.jurisdictions.get('GB'), currency: 'GBP', amountMinor: 200000 });
    webhook(p, { type: 'deposit.completed', id: dep.id });
    assert.equal(realBal(ledger, user), 60000);
    const alerts = p.services.aml.list();
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].rule, 'single_transaction_review');
    assert.equal(alerts[0].refId, dep.id);
    p.close();
  });
});

describe('provider failures and malformed events', () => {
  test('a provider failure during a deposit marks it failed and credits nothing', async () => {
    const provider = new FakeMonetaryProvider();
    provider.createDeposit = async () => { throw new Error('psp timeout'); };
    const { p, user, ledger } = realSetup({ provider });
    await assert.rejects(p.services.payments.requestDeposit({ user, mode: 'real', method: 'card', currency: 'GBP', amountMinor: 10000 }),
      (e) => e.code === 'payment_provider_error' && e.status === 502);
    const [row] = p.services.payments.listForUser(user.id);
    assert.equal(row.status, 'failed');
    assert.equal(realBal(ledger, user), 0);
    p.close();
  });

  test('a signed webhook with a malformed body is a validation error, not a crash', () => {
    const { p } = realSetup();
    const raw = '{not json';
    assert.throws(() => p.services.payments.handleWebhook({ provider: 'psp_test', rawBody: raw, signature: signWebhook(raw) }), { code: 'invalid_input' });
    p.close();
  });
});

describe('real-money withdrawals', () => {
  test('a withdrawal reaches the provider and is marked paid by webhook', async () => {
    const { p, user, ledger, provider } = realSetup();
    const dep = await p.services.payments.requestDeposit({ user, mode: 'real', method: 'card', currency: 'GBP', amountMinor: 20000 });
    webhook(p, { type: 'deposit.completed', id: dep.id });

    const wd = await p.services.payments.requestWithdrawal({ user, mode: 'real', method: 'card', currency: 'GBP', amountMinor: 5000 });
    assert.equal(wd.status, 'processing');
    assert.deepEqual(provider.withdrawals, [{ id: wd.id, amountMinor: 5000, currency: 'GBP' }]);
    assert.equal(realBal(ledger, user), 15000);

    webhook(p, { type: 'withdrawal.paid', id: wd.id });
    assert.equal(p.services.payments.getPayment(wd.id).status, 'paid');
    assert.equal(ledger.systemTotal('real', 'GBP'), 0);
    p.close();
  });

  test('withdrawal requires KYC level 2 in this profile, deposits only level 1', async () => {
    const { p, user } = realSetup();
    p.services.kyc.setLevel({ userId: user.id, level: 1, actor: 'test' });
    await assert.rejects(p.services.payments.requestWithdrawal({ user: p.services.accounts.getUser(user.id), mode: 'real', method: 'card', currency: 'GBP', amountMinor: 1000 }),
      (e) => e.details.reasons.some((r) => r.code === 'kyc_level_insufficient'));
    p.close();
  });

  test('a withdrawal cannot exceed the balance', async () => {
    const { p, user } = realSetup();
    await assert.rejects(p.services.payments.requestWithdrawal({ user, mode: 'real', method: 'card', currency: 'GBP', amountMinor: 5000 }), { code: 'insufficient_funds' });
    p.close();
  });

  test('when the provider call fails, the withdrawal is reversed and the balance restored', async () => {
    const provider = new FakeMonetaryProvider({ failWithdrawal: true });
    const { p, user, ledger } = realSetup({ provider });
    const dep = await p.services.payments.requestDeposit({ user, mode: 'real', method: 'card', currency: 'GBP', amountMinor: 20000 });
    webhook(p, { type: 'deposit.completed', id: dep.id });
    const wd = await p.services.payments.requestWithdrawal({ user, mode: 'real', method: 'card', currency: 'GBP', amountMinor: 5000 });
    assert.equal(wd.status, 'failed');
    assert.equal(realBal(ledger, user), 20000);
    assert.equal(ledger.systemTotal('real', 'GBP'), 0);
    p.close();
  });

  test('a withdrawal that crosses the review threshold is held; it is released only after its alert is cleared', async () => {
    const { p, user, ledger, provider } = realSetup();
    const dep = await p.services.payments.requestDeposit({ user, mode: 'real', method: 'card', currency: 'GBP', amountMinor: 70000 });
    p.services.responsible.setDailyDepositLimit({ userId: user.id, profile: p.config.jurisdictions.get('GB'), currency: 'GBP', amountMinor: 200000 });
    webhook(p, { type: 'deposit.completed', id: dep.id });
    const depositAlert = p.services.aml.list()[0];
    p.services.admin.resolveAlert({ actor: 'admin:compliance', id: depositAlert.id });

    const wd = await p.services.payments.requestWithdrawal({ user, mode: 'real', method: 'card', currency: 'GBP', amountMinor: 60000 });
    assert.equal(wd.status, 'on_hold');
    assert.equal(provider.withdrawals.length, 0, 'not sent to provider while held');
    assert.equal(realBal(ledger, user), 10000, 'funds are already moved out of the player wallet');

    await assert.rejects(p.services.admin.releaseWithdrawal({ actor: 'admin:x', id: wd.id }), { code: 'withdrawal_alerts_open' });

    const withdrawalAlert = p.services.aml.list().find((a) => a.refId === wd.id);
    p.services.admin.resolveAlert({ actor: 'admin:compliance', id: withdrawalAlert.id });
    const released = await p.services.admin.releaseWithdrawal({ actor: 'admin:compliance', id: wd.id });
    assert.equal(released.status, 'processing');
    assert.equal(provider.withdrawals.length, 1);
    p.close();
  });

  test('while any review alert is open, new withdrawals are blocked with aml_hold', async () => {
    const { p, user } = realSetup();
    const dep = await p.services.payments.requestDeposit({ user, mode: 'real', method: 'card', currency: 'GBP', amountMinor: 60000 });
    p.services.responsible.setDailyDepositLimit({ userId: user.id, profile: p.config.jurisdictions.get('GB'), currency: 'GBP', amountMinor: 200000 });
    webhook(p, { type: 'deposit.completed', id: dep.id });
    await assert.rejects(p.services.payments.requestWithdrawal({ user, mode: 'real', method: 'card', currency: 'GBP', amountMinor: 1000 }),
      (e) => e.details.reasons.some((r) => r.code === 'aml_hold'));
    p.close();
  });

  test('a withdrawal cannot be released unless it is on hold', async () => {
    const { p, user } = realSetup();
    const dep = await p.services.payments.requestDeposit({ user, mode: 'real', method: 'card', currency: 'GBP', amountMinor: 20000 });
    webhook(p, { type: 'deposit.completed', id: dep.id });
    const wd = await p.services.payments.requestWithdrawal({ user, mode: 'real', method: 'card', currency: 'GBP', amountMinor: 1000 });
    await assert.rejects(p.services.admin.releaseWithdrawal({ actor: 'admin:x', id: wd.id }), { code: 'withdrawal_not_on_hold' });
    p.close();
  });
});

describe('payment availability', () => {
  test('a method is available to a player only when the jurisdiction lists it AND a monetary provider is live', () => {
    const { p, user } = realSetup();
    assert.deepEqual(p.services.payments.availableMethods(user), { deposit: ['card'], withdrawal: ['card'] });
    p.close();
    const bare = makePlatform({ profiles: [profile('GB')] });
    bare.services.engine.setOperations({ code: 'GB', served: true, virtualEnabled: true, realEnabled: false, actor: 't', now: new Date() });
    const u = openPlayer(bare, { country: 'GB' }).user;
    assert.deepEqual(bare.services.payments.availableMethods(u), { deposit: [], withdrawal: [] });
    bare.close();
  });
});
