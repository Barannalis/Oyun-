import { join } from 'node:path';
import { randomInt } from 'node:crypto';
import { loadConfig } from './config/load.js';
import { Database } from './store/db.js';
import { createTranslator } from './i18n/index.js';
import { Ledger } from './wallet/ledger.js';
import { AuditLog } from './admin/audit.js';
import { LicenseRegistry } from './jurisdiction/licenses.js';
import { ResponsibleGambling } from './compliance/responsible.js';
import { AmlMonitor } from './compliance/aml.js';
import { KycService } from './compliance/kyc.js';
import { JurisdictionEngine } from './jurisdiction/engine.js';
import { AccountService } from './accounts/accounts.js';
import { PaymentService } from './payments/payments.js';
import { Sportsbook } from './sports/sportsbook.js';
import { FixtureSportsProvider } from './sports/provider.js';
import { CasinoService } from './gaming/casino.js';
import { Reporting } from './reporting/reports.js';
import { AdminService } from './admin/admin.js';
import { readFileSync } from 'node:fs';

export const systemClock = Object.freeze({ now: () => new Date() });

/**
 * Composition root. Wires every module together. Nothing else constructs
 * services, so tests can build an isolated platform with a fake clock, an
 * in-memory database and deterministic randomness.
 *
 * @param {object} opts
 * @param {string} [opts.configDir]       directory containing platform.json and jurisdictions/
 * @param {{platform: object, jurisdictions: Map}} [opts.config]  preloaded, already-validated config (tests)
 * @param {string} [opts.dbFile]          ':memory:' or a path
 * @param {{now: () => Date}} [opts.clock]
 * @param {(n: number) => number} [opts.rng]  uniform integer in [0, n)
 * @param {string} opts.adminToken        bearer token for the admin API (required)
 * @param {Record<string,string>} [opts.webhookSecrets]
 * @param {Array<object>} [opts.paymentProviders]  monetary providers (none by default)
 * @param {object} [opts.sportsProvider]  sports data provider (defaults to fixtures)
 */
export function createPlatform(opts) {
  const {
    configDir,
    config: preloaded = null,
    dbFile = ':memory:',
    clock = systemClock,
    rng = (n) => randomInt(n),
    adminToken,
    webhookSecrets = {},
    paymentProviders = [],
    sportsProvider = null,
  } = opts;
  if (!adminToken || adminToken.length < 24) throw new Error('adminToken must be set and at least 24 characters');

  // `config` lets tests inject validated profiles; production always loads from disk.
  const config = preloaded ?? loadConfig({ configDir });
  const platform = config.platform;
  const db = new Database(dbFile);
  const i18n = createTranslator({ defaultLocale: platform.default_locale });

  const audit = new AuditLog(db, clock);
  const ledger = new Ledger(db, clock);
  const licenses = new LicenseRegistry(db, clock);
  const responsible = new ResponsibleGambling({ db, clock, jurisdictions: config.jurisdictions });
  const aml = new AmlMonitor({ db, clock });
  const kyc = new KycService({ db, clock, audit });
  const engine = new JurisdictionEngine({
    db,
    clock,
    jurisdictions: config.jurisdictions,
    licenses,
    responsible,
    aml,
    platformFloor: platform.minimum_age_floor,
  });
  const accounts = new AccountService({ db, clock, engine, ledger, platform, i18n });
  const payments = new PaymentService({ db, clock, ledger, engine, aml, audit, platform, providers: paymentProviders, webhookSecrets });
  const sportsbook = new Sportsbook({ db, clock, ledger, engine, platform, audit });
  const provider = sportsProvider ?? new FixtureSportsProvider(JSON.parse(readFileSync(join(configDir, 'fixtures', 'sports.json'), 'utf8')));
  const casino = new CasinoService({ db, clock, ledger, engine, platform, rng });
  const reporting = new Reporting({ db, clock, jurisdictions: config.jurisdictions, engine, ledger, licenses, aml });
  const admin = new AdminService({
    db, clock, audit, engine, licenses, sportsbook, kyc, aml, payments, accounts, responsible, ledger, reporting,
    jurisdictions: config.jurisdictions,
  });

  return {
    config,
    db,
    clock,
    i18n,
    adminToken,
    sportsProvider: provider,
    services: { audit, ledger, licenses, responsible, aml, kyc, engine, accounts, payments, sportsbook, casino, reporting, admin },
    close() { db.close(); },
  };
}
