import { existsSync, statSync } from 'node:fs';

export const DEV_HOST_TOKEN = 'dev-host-token';
const MIN_PRODUCTION_TOKEN_LENGTH = 24;

export interface ServerConfig {
  port: number;
  host: string;
  hostToken: string;
  /** Geliştirme varsayılanı kullanılıyorsa true. Yalnızca uyarı için. */
  hostTokenIsDefault: boolean;
  corsOrigins: string[];
  giftDbPath: string;
  overlayDist?: string;
  production: boolean;
  tiktok?: { uniqueId: string; signApiKey?: string };
}

export class ConfigError extends Error {}

/**
 * Ortam değişkenlerini doğrular ve sunucu ayarlarını döndürür. Hatalar tek bir
 * ConfigError içinde toplu olarak raporlanır, böylece sorunlar birer birer değil
 * birlikte görülür.
 */
export function loadConfig(env: Record<string, string | undefined>): ServerConfig {
  const production = env.NODE_ENV === 'production';
  const errors: string[] = [];

  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push('PORT 1-65535 arasında bir tam sayı olmalıdır');

  const host = env.HOST?.trim() || '127.0.0.1';

  let hostToken = env.HOST_TOKEN?.trim() ?? '';
  let hostTokenIsDefault = false;
  if (hostToken.length === 0) {
    if (production) errors.push('HOST_TOKEN üretimde zorunludur');
    else {
      hostToken = DEV_HOST_TOKEN;
      hostTokenIsDefault = true;
    }
  } else if (production && hostToken.length < MIN_PRODUCTION_TOKEN_LENGTH) {
    errors.push(`HOST_TOKEN üretimde en az ${MIN_PRODUCTION_TOKEN_LENGTH} karakter olmalıdır`);
  }

  const corsRaw = env.CORS_ORIGINS ?? (production ? '' : 'http://127.0.0.1:5173,http://localhost:5173');
  const corsOrigins = corsRaw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const origin of corsOrigins) {
    try {
      const u = new URL(origin);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protokol');
    } catch {
      errors.push(`CORS_ORIGINS geçersiz bir adres içeriyor: ${origin}`);
    }
  }

  const giftDbPath = env.GIFT_DB?.trim() || './data/gifts.db';

  let overlayDist: string | undefined;
  const distRaw = env.OVERLAY_DIST?.trim();
  if (distRaw) {
    if (!existsSync(distRaw) || !statSync(distRaw).isDirectory()) errors.push(`OVERLAY_DIST klasörü bulunamadı: ${distRaw}`);
    else overlayDist = distRaw;
  }

  let tiktok: ServerConfig['tiktok'];
  if (env.TIKTOK_ENABLED === '1') {
    const uniqueId = (env.TIKTOK_UNIQUE_ID ?? '').trim().replace(/^@/, '');
    if (!/^[A-Za-z0-9._]{2,24}$/.test(uniqueId)) {
      errors.push('TIKTOK_UNIQUE_ID geçersiz (2-24 karakter: harf, rakam, nokta, alt çizgi)');
    } else {
      tiktok = { uniqueId, signApiKey: env.SIGN_API_KEY?.trim() || undefined };
    }
  }

  if (errors.length > 0) throw new ConfigError(errors.join('; '));

  return {
    port,
    host,
    hostToken,
    hostTokenIsDefault,
    corsOrigins,
    giftDbPath,
    overlayDist,
    production,
    tiktok,
  };
}
