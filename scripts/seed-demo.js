/**
 * Demo seed for the virtual MVP. Switches VIRTUAL mode on for the demo
 * jurisdictions, loads the sports schedule, and leaves REAL money OFF everywhere.
 * Real money needs legal approval, a license in the same country, and an
 * explicit operator switch. None of those are set here.
 *
 *   ADMIN_TOKEN=... node scripts/seed-demo.js
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { createPlatform } from '../src/app.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const adminToken = process.env.ADMIN_TOKEN;
if (!adminToken || adminToken.length < 24) {
  console.error('Set ADMIN_TOKEN (at least 24 characters).');
  process.exit(1);
}
const dataFile = process.env.DATA_FILE ?? join(root, 'data', 'platform.db');
mkdirSync(dirname(dataFile), { recursive: true });

const platform = createPlatform({ configDir: join(root, 'config'), dbFile: dataFile, adminToken });
const { admin, engine } = platform.services;
const actor = 'admin:seed-demo';

for (const code of platform.config.jurisdictions.keys()) {
  admin.setOperations({ actor, code, served: true, virtualEnabled: true, realEnabled: false });
  console.log(`served + virtual enabled: ${code} (real money: ${engine.operations(code).realEnabled ? 'ON' : 'off'})`);
}
const sync = await admin.syncSports({ actor, provider: platform.sportsProvider });
console.log(`sports events synced: ${sync.upserted}`);
platform.close();
