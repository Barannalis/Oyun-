import { createHmac, timingSafeEqual } from 'node:crypto';
import { newId, owners } from '../core/domain.js';
import { DomainError, ForbiddenError, ValidationError, ConflictError, NotFoundError, AuthError, InsufficientFundsError } from '../core/errors.js';

/**
 * Payment provider contract. Implementations live in code and are registered
 * explicitly. Only providers with `monetary: true` may move real money.
 *
 *   id: string
 *   monetary: true
 *   createDeposit({ id, userId, amountMinor, currency })
 *       -> Promise<{ providerRef: string, status: 'pending' | 'completed' }>
 *   requestWithdrawal({ id, userId, amountMinor, currency })
 *       -> Promise<{ providerRef: string }>
 *
 * Providers report later outcomes through signed webhooks (see handleWebhook).
 * The MVP registers none, so every real-money method is unavailable by default.
 */
export class PaymentService {
  constructor({ db, clock, ledger, engine, aml, audit, platform, providers = [], webhookSecrets = {} }) {
    this.db = db;
    this.clock = clock;
    this.ledger = ledger;
    this.engine = engine;
    this.aml = aml;
    this.audit = audit;
    this.methodMap = platform.payments.methods;
    this.providers = new Map();
    this.webhookSecrets = webhookSecrets;
    for (const p of providers) this.registerProvider(p);
  }

  registerProvider(provider) {
    if (provider.monetary !== true) throw new ValidationError('non_monetary_provider');
    if (this.providers.has(provider.id)) throw new ConflictError('provider_already_registered');
    this.providers.set(provider.id, provider);
  }

  /** The provider that handles a method, or null when the method is not live. */
  providerForMethod(method) {
    const providerId = this.methodMap[method];
    if (!providerId) return null;
    return this.providers.get(providerId) ?? null;
  }

  /** Methods a player can use right now: listed by the jurisdiction AND live. */
  availableMethods(user) {
    const profile = this.engine.profile(user.country);
    if (!profile) return { deposit: [], withdrawal: [] };
    const live = (ids) => ids.filter((m) => this.providerForMethod(m) !== null);
    return {
      deposit: live(profile.real_money.deposit.methods),
      withdrawal: live(profile.real_money.withdrawal.methods),
    };
  }

  /**
   * Engine decision plus provider availability, so the player sees every reason at once.
   * @returns {{allowed: boolean, reasons: Array<{code: string}>, jurisdiction: string|null}}
   */
  decide({ user, mode, action, currency, amountMinor, method }) {
    const decision = this.engine.evaluate({ user, mode, action, currency, amountMinor, method });
    const reasons = [...decision.reasons];
    if (!this.providerForMethod(method) && !reasons.some((r) => r.code === 'payment_method_unavailable')) {
      reasons.push({ code: 'payment_method_unavailable' });
    }
    return { allowed: reasons.length === 0, reasons, jurisdiction: decision.jurisdiction };
  }

  async requestDeposit({ user, mode, method, currency, amountMinor }) {
    if (mode !== 'real') throw new ValidationError('deposits_real_mode_only');
    const decision = this.decide({ user, mode, action: 'deposit', currency, amountMinor, method });
    if (!decision.allowed) throw new ForbiddenError(decision.reasons);
    const provider = this.providerForMethod(method);

    const id = newId('dep');
    const now = this.clock.now().toISOString();
    this.db
      .prepare(`INSERT INTO payment_transactions (id, kind, user_id, jurisdiction, mode, method, provider, currency, amount, status, created_at, updated_at)
                VALUES (?, 'deposit', ?, ?, 'real', ?, ?, ?, ?, 'pending', ?, ?)`)
      .run(id, user.id, decision.jurisdiction, method, provider.id, currency, amountMinor, now, now);

    let result;
    try {
      result = await provider.createDeposit({ id, userId: user.id, amountMinor, currency });
    } catch {
      this.db.prepare("UPDATE payment_transactions SET status = 'failed', updated_at = ? WHERE id = ?").run(this.clock.now().toISOString(), id);
      throw new DomainError('payment_provider_error', { status: 502 });
    }
    this.db.prepare('UPDATE payment_transactions SET provider_ref = ?, updated_at = ? WHERE id = ?')
      .run(result.providerRef, this.clock.now().toISOString(), id);
    if (result.status === 'completed') this.confirmDeposit(id);
    return this.getPayment(id);
  }

  /** Credits a pending deposit exactly once and runs AML monitoring. */
  confirmDeposit(id) {
    const row = this.getPayment(id);
    if (row.kind !== 'deposit') throw new NotFoundError('deposit');
    if (row.status !== 'pending') throw new ConflictError('deposit_not_pending');
    const profile = this.engine.profile(row.jurisdiction);
    const now = this.clock.now();

    return this.db.transaction(() => {
      const posted = this.ledger.post({
        type: 'deposit',
        mode: 'real',
        currency: row.currency,
        legs: [
          { owner: owners.payments(row.provider), amount: -row.amount },
          { owner: owners.user(row.userId), amount: row.amount },
        ],
        idempotencyKey: `deposit:${id}`,
        metadata: { paymentId: id },
      });
      this.db.prepare("UPDATE payment_transactions SET status = 'completed', ledger_tx_id = ?, updated_at = ? WHERE id = ?")
        .run(posted.id, now.toISOString(), id);
      const daily = this.engine.depositedToday(row.userId, row.currency, now);
      this.aml.evaluate({
        profile,
        userId: row.userId,
        refId: id,
        direction: 'deposit',
        currency: row.currency,
        amountMinor: row.amount,
        dailyTotalMinor: daily,
      });
      return this.getPayment(id);
    });
  }

  async requestWithdrawal({ user, mode, method, currency, amountMinor }) {
    if (mode !== 'real') throw new ValidationError('withdrawals_real_mode_only');
    const decision = this.decide({ user, mode, action: 'withdraw', currency, amountMinor, method });
    if (!decision.allowed) throw new ForbiddenError(decision.reasons);
    const provider = this.providerForMethod(method);
    const balance = this.ledger.balance(owners.user(user.id), 'real', currency);
    if (balance < amountMinor) throw new InsufficientFundsError();

    const id = newId('wdr');
    const now = this.clock.now();
    const profile = this.engine.profile(decision.jurisdiction);
    const alerts = this.db.transaction(() => {
      this.db
        .prepare(`INSERT INTO payment_transactions (id, kind, user_id, jurisdiction, mode, method, provider, currency, amount, status, created_at, updated_at)
                  VALUES (?, 'withdrawal', ?, ?, 'real', ?, ?, ?, ?, 'requested', ?, ?)`)
        .run(id, user.id, decision.jurisdiction, method, provider.id, currency, amountMinor, now.toISOString(), now.toISOString());
      const posted = this.ledger.post({
        type: 'withdrawal',
        mode: 'real',
        currency,
        legs: [
          { owner: owners.user(user.id), amount: -amountMinor },
          { owner: owners.payments(provider.id), amount: amountMinor },
        ],
        idempotencyKey: `withdrawal:${id}`,
        metadata: { paymentId: id },
      });
      this.db.prepare('UPDATE payment_transactions SET ledger_tx_id = ? WHERE id = ?').run(posted.id, id);
      return this.aml.evaluate({
        profile,
        userId: user.id,
        refId: id,
        direction: 'withdrawal',
        currency,
        amountMinor,
        dailyTotalMinor: this.withdrawnToday(user.id, currency, now) + amountMinor,
      });
    });

    if (alerts.some((a) => a.severity === 'review')) {
      this.db.prepare("UPDATE payment_transactions SET status = 'on_hold', updated_at = ? WHERE id = ?").run(this.clock.now().toISOString(), id);
      return this.getPayment(id);
    }
    await this.sendWithdrawal(id, provider);
    return this.getPayment(id);
  }

  /** Hands a withdrawal to the provider. A failure reverses the ledger movement. */
  async sendWithdrawal(id, provider) {
    const row = this.getPayment(id);
    try {
      const res = await provider.requestWithdrawal({ id, userId: row.userId, amountMinor: row.amount, currency: row.currency });
      this.db.prepare("UPDATE payment_transactions SET status = 'processing', provider_ref = ?, updated_at = ? WHERE id = ?")
        .run(res.providerRef, this.clock.now().toISOString(), id);
    } catch {
      this.failWithdrawal(id);
    }
  }

  failWithdrawal(id) {
    const row = this.getPayment(id);
    if (row.status === 'failed' || row.status === 'paid') return row;
    this.db.transaction(() => {
      this.ledger.post({
        type: 'withdrawal_reversal',
        mode: 'real',
        currency: row.currency,
        legs: [
          { owner: owners.payments(row.provider), amount: -row.amount },
          { owner: owners.user(row.userId), amount: row.amount },
        ],
        idempotencyKey: `withdrawal_reversal:${id}`,
        metadata: { paymentId: id },
      });
      this.db.prepare("UPDATE payment_transactions SET status = 'failed', updated_at = ? WHERE id = ?")
        .run(this.clock.now().toISOString(), id);
    });
    return this.getPayment(id);
  }

  /** Operator releases a held withdrawal once its alerts are cleared. */
  async releaseWithdrawal(id, actor) {
    const row = this.getPayment(id);
    if (row.kind !== 'withdrawal') throw new NotFoundError('withdrawal');
    if (row.status !== 'on_hold') throw new ConflictError('withdrawal_not_on_hold');
    if (this.aml.openReviewFor(id) > 0) throw new ConflictError('withdrawal_alerts_open');
    const provider = this.providers.get(row.provider);
    if (!provider) throw new ConflictError('payment_method_unavailable');
    this.audit.record({ actor, action: 'withdrawal.released', jurisdiction: row.jurisdiction, subject: id, details: { amount: row.amount, currency: row.currency } });
    await this.sendWithdrawal(id, provider);
    return this.getPayment(id);
  }

  /**
   * Verifies an HMAC-SHA256 signature over the raw body, then applies the event.
   * Events are idempotent: replays change nothing.
   * @param {{provider: string, rawBody: string, signature: string|undefined}} input
   */
  handleWebhook({ provider, rawBody, signature }) {
    const secret = this.webhookSecrets[provider];
    if (!secret || !signature) throw new AuthError('webhook_signature_invalid');
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(String(signature));
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new AuthError('webhook_signature_invalid');

    let event;
    try {
      event = JSON.parse(rawBody);
    } catch {
      throw new ValidationError('invalid_input', { field: 'body' });
    }
    const row = this.db.prepare('SELECT id FROM payment_transactions WHERE id = ? AND provider = ?').get(event.id, provider);
    if (!row) throw new NotFoundError('payment');
    switch (event.type) {
      case 'deposit.completed':
        if (this.getPayment(event.id).status === 'pending') this.confirmDeposit(event.id);
        break;
      case 'deposit.failed':
        this.db.prepare("UPDATE payment_transactions SET status = 'failed', updated_at = ? WHERE id = ? AND status = 'pending'")
          .run(this.clock.now().toISOString(), event.id);
        break;
      case 'withdrawal.paid':
        this.db.prepare("UPDATE payment_transactions SET status = 'paid', updated_at = ? WHERE id = ? AND status = 'processing'")
          .run(this.clock.now().toISOString(), event.id);
        break;
      case 'withdrawal.failed':
        this.failWithdrawal(event.id);
        break;
      default:
        throw new ValidationError('unknown_event_type');
    }
    return this.getPayment(event.id);
  }

  withdrawnToday(userId, currency, now) {
    const start = new Date(now);
    start.setUTCHours(0, 0, 0, 0);
    return this.db
      .prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM payment_transactions
                WHERE user_id = ? AND kind = 'withdrawal' AND currency = ? AND status NOT IN ('failed') AND created_at >= ?`)
      .get(userId, currency, start.toISOString()).total;
  }

  getPayment(id) {
    const r = this.db.prepare('SELECT * FROM payment_transactions WHERE id = ?').get(id);
    if (!r) throw new NotFoundError('payment');
    return mapPayment(r);
  }

  listForUser(userId) {
    return this.db.prepare('SELECT * FROM payment_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100')
      .all(userId).map(mapPayment);
  }

  listByStatus(status) {
    return this.db.prepare('SELECT * FROM payment_transactions WHERE status = ? ORDER BY created_at DESC LIMIT 500')
      .all(status).map(mapPayment);
  }
}

function mapPayment(r) {
  return {
    id: r.id,
    kind: r.kind,
    userId: r.user_id,
    jurisdiction: r.jurisdiction,
    mode: r.mode,
    method: r.method,
    provider: r.provider,
    currency: r.currency,
    amount: r.amount,
    status: r.status,
    providerRef: r.provider_ref,
    ledgerTxId: r.ledger_tx_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
