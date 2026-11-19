/**
 * Versioned schema. Append new migrations; never edit an applied one.
 * Money columns are INTEGER minor units. Timestamps are ISO-8601 UTC strings.
 */
export const MIGRATIONS = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    country TEXT NOT NULL,
    date_of_birth TEXT NOT NULL,
    locale TEXT NOT NULL,
    kyc_level INTEGER NOT NULL DEFAULT 0,
    self_excluded_until TEXT,
    role TEXT NOT NULL DEFAULT 'player',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL
  );
  CREATE TABLE wallets (
    id TEXT PRIMARY KEY,
    owner_key TEXT NOT NULL,
    mode TEXT NOT NULL,
    currency TEXT NOT NULL,
    balance INTEGER NOT NULL DEFAULT 0,
    UNIQUE (owner_key, mode, currency)
  );
  CREATE TABLE transactions (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    mode TEXT NOT NULL,
    currency TEXT NOT NULL,
    idempotency_key TEXT UNIQUE,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE TABLE entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tx_id TEXT NOT NULL REFERENCES transactions(id),
    wallet_id TEXT NOT NULL REFERENCES wallets(id),
    amount INTEGER NOT NULL CHECK (amount <> 0)
  );
  CREATE TABLE jurisdiction_operations (
    code TEXT PRIMARY KEY,
    served INTEGER NOT NULL DEFAULT 0,
    virtual_enabled INTEGER NOT NULL DEFAULT 0,
    real_enabled INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL
  );
  CREATE TABLE licenses (
    id TEXT PRIMARY KEY,
    jurisdiction TEXT NOT NULL,
    regulator TEXT NOT NULL,
    license_number TEXT NOT NULL,
    operator_entity TEXT NOT NULL,
    categories TEXT NOT NULL,
    status TEXT NOT NULL,
    valid_from TEXT,
    valid_until TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    jurisdiction TEXT,
    subject TEXT,
    details TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE sports_events (
    id TEXT PRIMARY KEY,
    sport TEXT NOT NULL,
    competition TEXT NOT NULL,
    region TEXT,
    starts_at TEXT NOT NULL,
    home TEXT NOT NULL,
    away TEXT NOT NULL,
    odds TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled',
    result TEXT,
    settled_at TEXT
  );
  CREATE TABLE bets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    mode TEXT NOT NULL,
    currency TEXT NOT NULL,
    jurisdiction TEXT NOT NULL,
    event_id TEXT NOT NULL REFERENCES sports_events(id),
    selection TEXT NOT NULL,
    odds_bp INTEGER NOT NULL,
    stake INTEGER NOT NULL,
    potential_payout INTEGER NOT NULL,
    status TEXT NOT NULL,
    payout INTEGER NOT NULL DEFAULT 0,
    tx_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    settled_at TEXT
  );
  CREATE TABLE casino_rounds (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    mode TEXT NOT NULL,
    currency TEXT NOT NULL,
    jurisdiction TEXT NOT NULL,
    game_id TEXT NOT NULL,
    stake INTEGER NOT NULL,
    payout INTEGER NOT NULL,
    outcome TEXT NOT NULL,
    tx_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE payment_transactions (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id),
    jurisdiction TEXT NOT NULL,
    mode TEXT NOT NULL,
    method TEXT NOT NULL,
    provider TEXT NOT NULL,
    currency TEXT NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL,
    provider_ref TEXT,
    ledger_tx_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE user_limits (
    user_id TEXT NOT NULL REFERENCES users(id),
    currency TEXT NOT NULL,
    daily_deposit INTEGER,
    pending_daily_deposit INTEGER,
    pending_effective_at TEXT,
    PRIMARY KEY (user_id, currency)
  );
  CREATE TABLE aml_alerts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    ref_id TEXT,
    rule TEXT NOT NULL,
    severity TEXT NOT NULL,
    status TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    resolved_at TEXT,
    resolved_by TEXT
  );
  CREATE INDEX idx_bets_event ON bets(event_id, status);
  CREATE INDEX idx_bets_user ON bets(user_id);
  CREATE INDEX idx_payments_user ON payment_transactions(user_id, kind, created_at);
  CREATE INDEX idx_alerts_user ON aml_alerts(user_id, status);
  CREATE INDEX idx_entries_wallet ON entries(wallet_id);
  `,
];
