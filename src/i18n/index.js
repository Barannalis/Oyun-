import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCALE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'locales');

/**
 * Loads every locale catalog. Keys are dotted paths in flat JSON:
 * { "reason.under_age": "..." }. Missing keys fall back to the default locale,
 * then to the key itself, so a gap never breaks a response.
 * @param {{defaultLocale: string, dir?: string}} opts
 */
export function createTranslator({ defaultLocale, dir = LOCALE_DIR }) {
  const catalogs = new Map();
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    catalogs.set(f.replace(/\.json$/, ''), JSON.parse(readFileSync(join(dir, f), 'utf8')));
  }
  if (!catalogs.has(defaultLocale)) throw new Error(`missing default locale catalog: ${defaultLocale}`);
  const supported = [...catalogs.keys()];

  /** Pick the best supported locale from an ordered candidate list. */
  function resolve(candidates = []) {
    for (const raw of candidates) {
      if (!raw) continue;
      const tag = String(raw).trim();
      if (catalogs.has(tag)) return tag;
      const base = tag.split('-')[0];
      if (catalogs.has(base)) return base;
    }
    return defaultLocale;
  }

  /** Parse an Accept-Language header into ordered tags. */
  function fromAcceptLanguage(header) {
    if (!header) return [];
    return header
      .split(',')
      .map((part) => part.split(';')[0].trim())
      .filter(Boolean);
  }

  function t(key, params = {}, locale = defaultLocale) {
    const template =
      catalogs.get(locale)?.[key] ?? catalogs.get(defaultLocale)?.[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_, name) =>
      params[name] !== undefined ? String(params[name]) : `{${name}}`,
    );
  }

  /** Full catalog for a locale, merged over the default (used by the web UI). */
  function catalog(locale) {
    const base = catalogs.get(defaultLocale);
    return { ...base, ...(catalogs.get(resolve([locale])) ?? {}) };
  }

  return { t, resolve, fromAcceptLanguage, supported, catalog, defaultLocale };
}
