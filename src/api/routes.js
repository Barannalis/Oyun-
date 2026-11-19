import { parseMoney } from '../core/money.js';
import { ValidationError, NotFoundError } from '../core/errors.js';
import { MODES, CATEGORIES, LICENSE_STATUSES, SELECTIONS, KYC_LEVELS } from '../core/domain.js';

/**
 * Route table. `access` is enforced by the HTTP layer:
 *   public  - anyone
 *   player  - a valid player session token
 *   admin   - the operator admin token (X-Actor names the human in the audit log)
 */
const r = (method, path, access, handler) => ({ method, path, access, handler });

const need = (value, field) => {
  if (value === undefined || value === null || value === '') throw new ValidationError('invalid_input', { field });
  return value;
};

const publicUser = (u) => ({
  id: u.id,
  username: u.username,
  displayName: u.displayName,
  country: u.country,
  locale: u.locale,
  kycLevel: u.kycLevel,
  selfExcludedUntil: u.selfExcludedUntil,
});

function modeOf(body) {
  const mode = body.mode ?? 'virtual';
  if (!MODES.includes(mode)) throw new ValidationError('invalid_mode');
  return mode;
}

function currencyOf(body, mode) {
  if (mode === 'virtual') return 'VC';
  return need(body.currency, 'currency');
}

export function buildRoutes() {
  return [
    // ---- public ----
    r('GET', '/api/v1/health', 'public', () => ({ ok: true })),

    r('GET', '/api/v1/i18n/:locale', 'public', (ctx, p) => ({
      locale: p.i18n.resolve([ctx.params.locale]),
      messages: p.i18n.catalog(ctx.params.locale),
    })),

    r('GET', '/api/v1/countries', 'public', (_ctx, p) => {
      const ops = p.services.engine.listOperations();
      return ops
        .filter((o) => o.served)
        .map((o) => {
          const prof = p.config.jurisdictions.get(o.code);
          return {
            code: o.code,
            name: prof.name,
            locales: prof.locales,
            virtual: o.virtualEnabled && prof.virtual.enabled,
            realMoneyEnabled: o.realEnabled,
          };
        });
    }),

    r('POST', '/api/v1/auth/register', 'public', (ctx, p) => {
      const { token, user } = p.services.accounts.register(ctx.body);
      return { status: 201, body: { token, user: publicUser(user) } };
    }),

    r('POST', '/api/v1/auth/login', 'public', (ctx, p) => {
      const { token, user } = p.services.accounts.login(ctx.body);
      return { token, user: publicUser(user) };
    }),

    r('POST', '/api/v1/auth/logout', 'player', (ctx, p) => {
      p.services.accounts.logout(ctx.headers.authorization.slice(7));
      return { ok: true };
    }),

    r('POST', '/api/v1/webhooks/payments/:provider', 'public', (ctx, p) => {
      const payment = p.services.payments.handleWebhook({
        provider: ctx.params.provider,
        rawBody: ctx.rawBody,
        signature: ctx.headers['x-signature'],
      });
      return { ok: true, status: payment.status };
    }),

    // ---- player ----
    r('GET', '/api/v1/me', 'player', (ctx, p) => {
      const u = p.services.accounts.getUser(ctx.user.id);
      return {
        user: publicUser(u),
        wallets: p.services.accounts.wallets(u.id),
        availability: p.services.engine.availability(u),
        paymentMethods: p.services.payments.availableMethods(u),
        realMoney: { currencies: p.config.jurisdictions.get(u.country)?.real_money.currencies ?? [] },
      };
    }),

    r('GET', '/api/v1/sports/events', 'player', (_ctx, p) => ({ events: p.services.sportsbook.listOpen() })),

    r('GET', '/api/v1/bets', 'player', (ctx, p) => ({ bets: p.services.sportsbook.listBets(ctx.user.id) })),

    r('POST', '/api/v1/bets', 'player', (ctx, p) => {
      const mode = modeOf(ctx.body);
      const currency = currencyOf(ctx.body, mode);
      const stakeMinor = parseMoney(need(ctx.body.stake, 'stake'), currency);
      const bet = p.services.sportsbook.placeBet({
        user: ctx.user,
        mode,
        currency,
        eventId: need(ctx.body.eventId, 'eventId'),
        selection: need(ctx.body.selection, 'selection'),
        stakeMinor,
      });
      return { status: 201, body: { bet } };
    }),

    r('GET', '/api/v1/casino/games', 'player', (_ctx, p) => ({ games: p.services.casino.listGames() })),

    r('GET', '/api/v1/casino/rounds', 'player', (ctx, p) => ({ rounds: p.services.casino.listRounds(ctx.user.id) })),

    r('POST', '/api/v1/casino/games/:id/play', 'player', (ctx, p) => {
      const mode = modeOf(ctx.body);
      const currency = currencyOf(ctx.body, mode);
      const stakeMinor = parseMoney(need(ctx.body.stake, 'stake'), currency);
      const round = p.services.casino.play({
        user: ctx.user,
        mode,
        currency,
        gameId: ctx.params.id,
        stakeMinor,
        params: ctx.body.params ?? {},
      });
      return { status: 201, body: { round } };
    }),

    r('GET', '/api/v1/wallet/payments', 'player', (ctx, p) => ({ payments: p.services.payments.listForUser(ctx.user.id) })),

    r('POST', '/api/v1/wallet/deposits', 'player', async (ctx, p) => {
      const currency = need(ctx.body.currency, 'currency');
      const amountMinor = parseMoney(need(ctx.body.amount, 'amount'), currency);
      const payment = await p.services.payments.requestDeposit({
        user: ctx.user,
        mode: 'real',
        method: need(ctx.body.method, 'method'),
        currency,
        amountMinor,
      });
      return { status: 201, body: { payment } };
    }),

    r('POST', '/api/v1/wallet/withdrawals', 'player', async (ctx, p) => {
      const currency = need(ctx.body.currency, 'currency');
      const amountMinor = parseMoney(need(ctx.body.amount, 'amount'), currency);
      const payment = await p.services.payments.requestWithdrawal({
        user: ctx.user,
        mode: 'real',
        method: need(ctx.body.method, 'method'),
        currency,
        amountMinor,
      });
      return { status: 201, body: { payment } };
    }),

    r('PUT', '/api/v1/responsible/deposit-limit', 'player', (ctx, p) => {
      const currency = need(ctx.body.currency, 'currency');
      const profile = p.config.jurisdictions.get(ctx.user.country);
      if (!profile) throw new NotFoundError('jurisdiction');
      const raw = ctx.body.amount;
      const amountMinor = raw === null ? null : parseMoney(need(raw, 'amount'), currency);
      return p.services.responsible.setDailyDepositLimit({ userId: ctx.user.id, profile, currency, amountMinor });
    }),

    r('POST', '/api/v1/responsible/self-exclusion', 'player', (ctx, p) => {
      const profile = p.config.jurisdictions.get(ctx.user.country);
      if (!profile) throw new NotFoundError('jurisdiction');
      const until = p.services.responsible.selfExclude({
        userId: ctx.user.id,
        profile,
        currentExclusionUntil: ctx.user.selfExcludedUntil,
        untilIso: need(ctx.body.until, 'until'),
      });
      return { selfExcludedUntil: until };
    }),

    // ---- admin ----
    r('GET', '/api/v1/admin/jurisdictions', 'admin', (_ctx, p) => ({ jurisdictions: p.services.admin.listJurisdictions() })),

    r('PUT', '/api/v1/admin/jurisdictions/:code/operations', 'admin', (ctx, p) => {
      const b = ctx.body;
      return p.services.admin.setOperations({
        actor: ctx.actor,
        code: ctx.params.code,
        served: need(b.served, 'served'),
        virtualEnabled: need(b.virtualEnabled, 'virtualEnabled'),
        realEnabled: need(b.realEnabled, 'realEnabled'),
      });
    }),

    r('GET', '/api/v1/admin/licenses', 'admin', (ctx, p) => ({ licenses: p.services.licenses.list(ctx.query.jurisdiction ?? null) })),

    r('POST', '/api/v1/admin/licenses', 'admin', (ctx, p) => {
      const b = ctx.body;
      const categories = need(b.categories, 'categories');
      if (!Array.isArray(categories) || !categories.every((c) => CATEGORIES.includes(c))) throw new ValidationError('invalid_input', { field: 'categories' });
      if (b.status !== undefined && !LICENSE_STATUSES.includes(b.status)) throw new ValidationError('invalid_input', { field: 'status' });
      return {
        status: 201,
        body: {
          license: p.services.admin.createLicense({
            actor: ctx.actor,
            input: {
              jurisdiction: need(b.jurisdiction, 'jurisdiction'),
              regulator: need(b.regulator, 'regulator'),
              licenseNumber: need(b.licenseNumber, 'licenseNumber'),
              operatorEntity: need(b.operatorEntity, 'operatorEntity'),
              categories,
              status: b.status ?? 'pending',
              validFrom: b.validFrom ?? null,
              validUntil: b.validUntil ?? null,
            },
          }),
        },
      };
    }),

    r('PATCH', '/api/v1/admin/licenses/:id', 'admin', (ctx, p) => ({
      license: p.services.admin.setLicenseStatus({ actor: ctx.actor, id: ctx.params.id, status: need(ctx.body.status, 'status') }),
    })),

    r('POST', '/api/v1/admin/sports/sync', 'admin', async (ctx, p) => ({
      result: await p.services.admin.syncSports({ actor: ctx.actor, provider: p.sportsProvider }),
    })),

    r('POST', '/api/v1/admin/sports/events/:id/settle', 'admin', (ctx, p) => {
      const result = need(ctx.body.result, 'result');
      if (!SELECTIONS.includes(result)) throw new ValidationError('invalid_selection');
      return p.services.admin.settleEvent({ actor: ctx.actor, eventId: ctx.params.id, result });
    }),

    r('PUT', '/api/v1/admin/users/:id/kyc', 'admin', (ctx, p) => {
      const level = need(ctx.body.level, 'level');
      if (!KYC_LEVELS.includes(level)) throw new ValidationError('invalid_input', { field: 'level' });
      return { level: p.services.admin.setKyc({ actor: ctx.actor, userId: ctx.params.id, level }) };
    }),

    r('POST', '/api/v1/admin/users/:id/virtual-grant', 'admin', (ctx, p) => {
      const amountMinor = parseMoney(need(ctx.body.amount, 'amount'), 'VC');
      return p.services.admin.grantVirtual({ actor: ctx.actor, userId: ctx.params.id, amountMinor });
    }),

    r('GET', '/api/v1/admin/aml/alerts', 'admin', (ctx, p) => ({ alerts: p.services.admin.listAlerts(ctx.query.status ?? 'open') })),

    r('POST', '/api/v1/admin/aml/alerts/:id/resolve', 'admin', (ctx, p) => ({
      alert: p.services.admin.resolveAlert({ actor: ctx.actor, id: ctx.params.id }),
    })),

    r('GET', '/api/v1/admin/withdrawals', 'admin', (ctx, p) => ({ withdrawals: p.services.admin.listWithdrawals(ctx.query.status ?? 'on_hold') })),

    r('POST', '/api/v1/admin/withdrawals/:id/release', 'admin', async (ctx, p) => ({
      withdrawal: await p.services.admin.releaseWithdrawal({ actor: ctx.actor, id: ctx.params.id }),
    })),

    r('GET', '/api/v1/admin/dashboard', 'admin', (ctx, p) => ({
      jurisdictions: p.services.reporting.dashboard({ days: Number(ctx.query.days ?? 30) || 30 }),
    })),

    r('GET', '/api/v1/admin/reports/:code', 'admin', (ctx, p) => {
      const to = ctx.query.to ?? p.clock.now().toISOString();
      const from = ctx.query.from ?? new Date(Date.parse(to) - 30 * 86400000).toISOString();
      const mode = ctx.query.mode ?? 'real';
      if (!MODES.includes(mode)) throw new ValidationError('invalid_mode');
      const report = p.services.reporting.jurisdictionReport({ code: ctx.params.code, mode, from, to });
      if (!report) throw new NotFoundError('jurisdiction');
      return report;
    }),

    r('GET', '/api/v1/admin/audit', 'admin', (ctx, p) => ({
      entries: p.services.audit.list({ limit: Math.min(Number(ctx.query.limit ?? 100) || 100, 500), jurisdiction: ctx.query.jurisdiction ?? null }),
    })),
  ];
}
