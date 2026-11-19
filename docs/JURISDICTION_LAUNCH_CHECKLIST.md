# Enabling a jurisdiction

Use this checklist before switching real money on in any country. Each item needs a named owner and evidence. Skipping one fails closed, so the platform will refuse the action. It will not warn and continue.

## 1. Legal (counsel, outside this codebase)
- [ ] Written opinion that the operator may offer each category in this country, and under which licence.
- [ ] Age requirement confirmed. Set `real_money.minimum_age`.
- [ ] Permitted categories, currencies, restricted games and required responsible-gambling tools confirmed.
- [ ] Tax and reporting duties confirmed (`tax.*`). Report cadence and recipient confirmed.
- [ ] Advertising, bonus and promotion rules confirmed. These are not yet modelled in the platform.

## 2. Config (a code review in git)
- [ ] Update `config/jurisdictions/<CC>.json`:
  - `real_money.legal_review` → `status: "approved"`, with `reference` and `reviewed_at`.
  - `permitted_categories`, `currencies`, `restricted_games`.
  - `kyc.deposit_level` and `kyc.withdrawal_level` (not null).
  - `deposit` / `withdrawal` methods, and min/max limits per currency.
  - `aml` thresholds per currency.
  - `responsible_gambling`: cooling-off, caps, self-exclusion minimum.
- [ ] Run `npm test`. Config validation must pass.

## 3. Licence (in the database, audited)
- [ ] `POST /api/v1/admin/licenses` with the regulator, licence number, operating entity, categories, validity window. Status `pending` until verified.
- [ ] Verify the licence document. Then `PATCH /api/v1/admin/licenses/:id` with `{"status": "active"}`.
- [ ] Confirm the licence covers the category, and that it is the right country. A licence elsewhere does not count.

## 4. Providers
- [ ] Register a **monetary** payment provider in code, and map its methods in `config/platform.json`.
- [ ] Set the webhook secret for that provider. Test signed webhooks end to end in the provider's sandbox.
- [ ] Certified RNG evidence for any casino or game provider.

## 5. Compliance operations
- [ ] KYC process staffed for the level thresholds. Admin records outcomes via `PUT /api/v1/admin/users/:id/kyc`.
- [ ] AML alert queue owned. Review SLA set. Reporting-threshold alerts have a filing process.
- [ ] Responsible-gambling support and self-exclusion handling in place.

## 6. Switch on (operator, audited)
- [ ] `PUT /api/v1/admin/jurisdictions/<CC>/operations` with `{"served": true, "virtualEnabled": true, "realEnabled": true}`.
- [ ] Check `GET /api/v1/admin/dashboard` shows the gates green for this country.
- [ ] Test with a staff account in the country before opening to players.

## Emergency stop
`PUT /api/v1/admin/jurisdictions/<CC>/operations` with `"realEnabled": false` stops real money for that country on the next request. Every change is written to the audit log with the actor's name (`X-Actor` header).
