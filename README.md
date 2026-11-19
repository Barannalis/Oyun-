# Oyun- · Global Betting Platform

A **country-neutral, multi-jurisdiction** betting and gaming platform. The core assumes no country, currency, language or regulator. Each jurisdiction is configured as data and checked at runtime.

**Status: virtual-money MVP.** Virtual betting and casino play are fully functional. Real-money infrastructure is built and tested, but **switched off in every country** until legal review, a license, and an operator switch are all in place. See [docs/JURISDICTION_LAUNCH_CHECKLIST.md](docs/JURISDICTION_LAUNCH_CHECKLIST.md).

## What it does

- **Jurisdiction engine:** per country, decides availability, licensed categories, restricted games, age, payment methods, deposit/withdrawal rules, responsible-gambling requirements, and tax/reporting. Default deny.
- **Licensing:** licenses are scoped to one country and a set of categories. A license elsewhere never counts.
- **Real-money gates:** legal review approved in config, operator switch on in the database, and an active license in that country. All three must be open.
- **Virtual mode:** independent of licensing. Non-monetary, with its own currency (`VC`) that cannot be withdrawn.
- **Multi-currency ledger:** double-entry, integer minor units, overdraft protection, idempotent postings, zero-sum invariant.
- **Compliance:** KYC levels, AML monitoring with holds, daily deposit limits with cooling-off, self-exclusion.
- **Payments:** a provider contract that accepts only monetary providers. Signed webhooks. None is registered in the MVP.
- **Sports and casino:** provider contracts with a fixture sports feed and a built-in dice game.
- **Multi-language:** English and French catalogs, with fallback. Errors and reasons are localized per request.
- **Administration:** central admin API with an audit log for every change, per-country dashboards, and per-country reports.

## Quick start

Requires Node.js 22.13 or later. There are no runtime dependencies.

```bash
export ADMIN_TOKEN="$(openssl rand -hex 24)"   # at least 24 characters
npm run seed     # switches virtual mode on for the demo countries and loads the schedule
npm start        # http://localhost:3000
npm test         # 90+ tests
```

Environment variables:

| Name | Default | Purpose |
|---|---|---|
| `ADMIN_TOKEN` | required | Bearer token for the admin API. The server refuses to start without it. |
| `PORT` | `3000` | HTTP port |
| `DATA_FILE` | `data/platform.db` | SQLite file (git-ignored) |

## Docker ile yayınlama

```bash
docker build -t betting-site-virtual .
docker run -p 3000:3000 -e ADMIN_TOKEN="$(openssl rand -hex 24)" -v betting-data:/data betting-site-virtual
```

İmaj yalnızca sanal para modunu açar. Gerçek para hiçbir ülkede varsayılan olarak açık değildir.

## Configuration

- `config/platform.json`: platform-wide settings (age floor, languages, signup grant, stake caps, payment method mapping).
- `config/jurisdictions/<CC>.json`: one profile per country. Validated at boot. The shipped `GB`, `DE` and `TR` profiles are **placeholders with no legal determinations**.
- `config/fixtures/sports.json`: demo schedule for the fixture sports provider.

## API overview

| Tier | Routes |
|---|---|
| Public | `GET /api/v1/health`, `GET /api/v1/countries`, `GET /api/v1/i18n/:locale`, `POST /api/v1/auth/register`, `POST /api/v1/auth/login`, `POST /api/v1/webhooks/payments/:provider` (HMAC-signed) |
| Player (bearer session) | `GET /api/v1/me`, `GET /api/v1/sports/events`, `POST /api/v1/bets`, `GET /api/v1/bets`, `GET /api/v1/casino/games`, `POST /api/v1/casino/games/:id/play`, `POST /api/v1/wallet/deposits`, `POST /api/v1/wallet/withdrawals`, `PUT /api/v1/responsible/deposit-limit`, `POST /api/v1/responsible/self-exclusion` |
| Admin (`Authorization: Bearer $ADMIN_TOKEN`, optional `X-Actor`) | `GET /api/v1/admin/jurisdictions`, `PUT /api/v1/admin/jurisdictions/:code/operations`, `GET/POST /api/v1/admin/licenses`, `PATCH /api/v1/admin/licenses/:id`, `POST /api/v1/admin/sports/sync`, `POST /api/v1/admin/sports/events/:id/settle`, `PUT /api/v1/admin/users/:id/kyc`, `GET /api/v1/admin/aml/alerts`, `POST /api/v1/admin/aml/alerts/:id/resolve`, `GET /api/v1/admin/withdrawals`, `POST /api/v1/admin/withdrawals/:id/release`, `GET /api/v1/admin/dashboard`, `GET /api/v1/admin/reports/:code`, `GET /api/v1/admin/audit` |

Money in requests is a decimal string (for example `"10.50"`), parsed by the currency's exponent. Responses use integer minor units.

A refused action returns HTTP 403 with every reason:

```json
{ "error": { "code": "forbidden", "message": "This action is not permitted.",
  "details": { "reasons": [ { "code": "no_active_license", "message": "No active license covers this activity in your country." } ] } } }
```

Open the client at `http://localhost:3000/`. It is a plain page with no build step.

## Layout

```
config/            platform settings, jurisdiction profiles, sports fixtures
src/core           money, errors, domain constants
src/config         strict config validation and loading
src/store          SQLite, migrations, transactions
src/wallet         double-entry ledger
src/jurisdiction   decision engine, licenses
src/compliance     KYC, AML, responsible gambling
src/accounts       registration and sessions
src/payments       provider contract, deposits, withdrawals, webhooks
src/sports         sports provider contract, sportsbook
src/gaming         casino registry and dice
src/reporting      GGR, tax, dashboards
src/admin          administration and audit log
src/api            router, auth tiers, error envelope, routes
src/i18n           locale catalogs
src/web/public     browser client
test/              node:test suites
docs/              architecture and launch checklist
```

## Not yet built

Before real money goes live anywhere, these must be built. The full list is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#known-gaps-before-any-real-money-launch). The main items are: production auth (SSO/MFA, login rate limiting), verified player location, KYC and sanctions providers, a PostgreSQL deployment, real payment and sports/casino provider adapters, and tax and regulatory filing.

## License

CC0 1.0 Universal (see `LICENSE`).
