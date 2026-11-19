# Architecture

This platform is **country-neutral**. Nothing in the core assumes a jurisdiction, currency, language or regulator. Every country-specific fact lives in data (`config/jurisdictions/*.json`) or in the operator's database, and is checked at runtime.

## Principles

1. **Default deny.** A country with no profile, or one the operator has not switched on, gets nothing. There is no default country.
2. **Licenses are per jurisdiction.** A license in one country never authorises activity in another. Every license lookup filters by the player's country first.
3. **Real money needs every gate open.** Virtual mode and real money are separate products with separate gates (see below).
4. **Money is integers.** Amounts are minor units plus a currency code. Odds and rates are basis points. Floats never touch balances.
5. **Double-entry ledger.** Every movement is a balanced transaction. Balances can be checked against a zero-sum invariant at any time.
6. **Every decision explains itself.** The engine returns every reason an action is refused, with localized text.
7. **Compliance config is versioned, operator state is audited.** Legal profiles live in git and need a code review. Kill switches and license changes live in the database and each change is audit-logged with its actor.

## The three gates for real money

An action in real-money mode is allowed only if **all** of these hold for the player's country:

| # | Gate | Where it lives | Changed by |
|---|------|----------------|------------|
| 1 | Legal review approved (`real_money.legal_review.status = "approved"`, with reference and date) | `config/jurisdictions/<CC>.json` | Code review |
| 2 | Operator switch on (`real_enabled`) and country served | Database `jurisdiction_operations` | Admin API (audited, kill switch) |
| 3 | Active license in **that** country covering **that** category, inside its validity window | Database `licenses` | Admin API (audited) |

On top of those, the profile supplies the category permitted by law, the currencies, age, KYC level, deposit/withdrawal rules, responsible-gambling limits and AML thresholds. A missing policy field denies the action (for example, `minimum_age: null` gives `age_policy_missing`).

**Virtual mode** needs only the country's `virtual.enabled` and the operator's `virtual_enabled` switch. It never depends on a license.

## Jurisdiction engine

`src/jurisdiction/engine.js` is the single decision point. Its inputs are the player, mode, category, game key, action, currency, amount and payment method. Its output is `{ allowed, reasons[], jurisdiction }`, where each reason is a stable code such as `no_active_license` or `kyc_level_insufficient`. The client maps codes to text through the locale catalogs.

Checks, in order: country profile exists → country served → age → account active → then, by mode:

- **Virtual:** virtual enabled, category offered, game not restricted.
- **Real:** operator switch, legal review, currency allowed, category permitted by law, license valid, game not restricted, not self-excluded, KYC level, payment method, amount limits, daily deposit limit, no open AML review (withdrawals).

## Profile contents (per jurisdiction)

| Concern | Field(s) |
|---|---|
| Languages | `locales`, `default_locale` |
| Virtual offering | `virtual.enabled`, `virtual.categories`, `virtual.restricted_games` |
| Legal status | `real_money.legal_review` |
| Age | `real_money.minimum_age` (platform floor of 18 always applies) |
| Licensed scope | `real_money.permitted_categories`, `real_money.currencies`, `real_money.restricted_games` |
| KYC | `real_money.kyc.deposit_level`, `withdrawal_level` |
| Payments | `real_money.deposit` / `withdrawal`: `methods`, `min`, `max_per_tx` (keyed by currency) |
| AML | `real_money.aml`: `single_transaction_review`, `daily_review`, `reporting` (keyed by currency) |
| Responsible gambling | `real_money.responsible_gambling`: cooling-off hours, daily deposit cap, self-exclusion minimum, required tools |
| Tax and reporting | `tax.gaming_duty_bps`, `tax.report_currency`, `tax.report_period` |

Every money map is keyed by ISO currency and holds integer minor units. Virtual currency (`VC`) is rejected in these maps by the validator.

The validator (`src/config/validate.js`) runs at boot and refuses to start on any invalid profile. Shipped profiles (`GB`, `DE`, `TR`) are placeholders: they contain **no legal determinations**, and real money is off in each.

## Modules

| Path | Responsibility |
|---|---|
| `src/core/` | Money (minor units, bp math, ISO registry), errors, domain constants, age |
| `src/config/` | Strict validation and loading of platform and jurisdiction config |
| `src/store/` | SQLite (built-in `node:sqlite`), versioned migrations, nested transactions via SAVEPOINT |
| `src/wallet/ledger.js` | Double-entry, multi-currency ledger, idempotency, overdraft protection |
| `src/jurisdiction/` | Decision engine, operator switches, license registry |
| `src/compliance/` | KYC levels, AML monitoring and holds, responsible gambling (limits, self-exclusion) |
| `src/accounts/` | Registration (engine-checked), scrypt passwords, hashed session tokens |
| `src/payments/` | Provider contract, deposits, withdrawals, holds, signed webhooks |
| `src/sports/` | Sports data provider contract, fixture provider, sportsbook and settlement |
| `src/gaming/` | Casino game registry and the built-in dice game |
| `src/reporting/` | Per-jurisdiction GGR and tax (tax is `not_configured` unless a rate is set), dashboards |
| `src/admin/` | Central administration and the audit log |
| `src/api/` | Router, auth tiers (public / player / admin), uniform errors, route table |
| `src/i18n/` | Locale catalogs (`en`, `fr`), fallback chain, request language negotiation |
| `src/web/public/` | Minimal dependency-free client for the virtual MVP |

## Money flows

- **Signup grant:** `system:grants` → user (virtual, VC).
- **Virtual bet:** user → `system:house:virtual`; settlement pays the winner from the house.
- **Virtual casino round:** stake to house; payout from house, both in one transaction.
- **Real deposit:** pending row (no money yet) → provider confirms by signed webhook → `system:payments:<provider>` → user, credited once (idempotency key).
- **Real withdrawal:** user → `system:payments:<provider>` → provider. Held if an AML review alert is raised. A failed provider call reverses the movement.

`Ledger.systemTotal(mode, currency)` must always be zero. The tests assert this after bets, settlements, casino rounds and deposit/withdrawal flows.

## Sports and gaming providers

Both are contracts, not integrations:

- `src/sports/provider.js` defines `fetchSchedule(now)`. The MVP ships a fixture provider backed by `config/fixtures/sports.json`. Global feeds are adapters that implement the same method.
- `src/gaming/casino.js` defines the game shape (`id`, `category`, `play`). The restriction key is `game:<id>` (and `sport:<sport>` for sports), so each jurisdiction can block games individually. Third-party studios are adapters. Their outcomes must come from a certified RNG supplied by the provider.

## Payment providers

`src/payments/payments.js` defines the provider contract. A provider must declare `monetary: true` to be registered, and the registry refuses anything else. A method is usable only when the jurisdiction lists it **and** a monetary provider is registered for it. The MVP registers none, so real-money payment is unavailable. Tests use a fake monetary provider to prove the real path works once a provider and license exist.

## Data model (summary)

`users`, `sessions` (token hashes), `wallets` (owner × mode × currency), `transactions` and `entries` (ledger), `jurisdiction_operations`, `licenses`, `audit_log`, `sports_events`, `bets`, `casino_rounds`, `payment_transactions`, `user_limits`, `aml_alerts`. Schema changes are appended as numbered migrations in `src/store/schema.js`.

## Known gaps before any real-money launch

These are deliberate MVP boundaries. Each one blocks real money until it is built:

- **Authentication:** username and password with an opaque session token. Production needs OIDC or SSO, MFA, rate limiting on login and registration (none exists yet), and account recovery.
- **Location:** the player declares their country. Real money needs verified location (IP and device checks, with a geolocation provider) before any gate opens.
- **KYC/AML providers:** verification is manual through the admin API. Real integrations and sanctions/PEP screening are not built.
- **Database:** SQLite, single process. The ledger's invariants hold within one process. A multi-node deployment needs PostgreSQL with the same transactional guarantees.
- **Payment providers and webhooks:** the HMAC scheme is generic. Each PSP has its own signature format and will need an adapter.
- **Tax and regulatory reports:** the platform computes GGR and produces a report shape. It does not file anything, and it does not compute legally correct tax. Those rules come from counsel and the accountant.
- **Responsible gambling:** deposit limits, self-exclusion and cooling-off are implemented. Reality checks, loss limits, session limits and the required tools listed per jurisdiction are configured but not yet enforced.
- **Localization:** `en` and `fr` are included. Other locales need professional translation and review before use.
