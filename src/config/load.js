import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { validateJurisdiction, validatePlatform } from './validate.js';
import { ConfigError } from '../core/errors.js';

/**
 * Loads platform settings and every jurisdiction profile from disk.
 * Compliance configuration lives in version control, not in the database.
 * @param {{configDir: string}} opts
 */
export function loadConfig({ configDir }) {
  const platform = JSON.parse(readFileSync(join(configDir, 'platform.json'), 'utf8'));
  validatePlatform(platform);

  const dir = join(configDir, 'jurisdictions');
  const jurisdictions = new Map();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const profile = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    validateJurisdiction(profile, file);
    if (jurisdictions.has(profile.code)) throw new ConfigError(`duplicate jurisdiction ${profile.code}`);
    jurisdictions.set(profile.code, Object.freeze(profile));
  }
  return Object.freeze({ platform: Object.freeze(platform), jurisdictions });
}
