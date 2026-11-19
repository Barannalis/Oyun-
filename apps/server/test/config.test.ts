import { describe, expect, it } from 'vitest';
import { ConfigError, DEV_HOST_TOKEN, loadConfig } from '../src/config';

describe('loadConfig', () => {
  it('geliştirmede varsayılanlarla çalışır ve varsayılan anahtarı işaretler', () => {
    const c = loadConfig({});
    expect(c.port).toBe(3000);
    expect(c.host).toBe('127.0.0.1');
    expect(c.hostToken).toBe(DEV_HOST_TOKEN);
    expect(c.hostTokenIsDefault).toBe(true);
    expect(c.corsOrigins).toContain('http://127.0.0.1:5173');
    expect(c.tiktok).toBeUndefined();
  });

  it('üretimde HOST_TOKEN zorunludur ve en az 24 karakter olmalıdır', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(ConfigError);
    expect(() => loadConfig({ NODE_ENV: 'production', HOST_TOKEN: 'kisa' })).toThrow(/en az 24/);
    const ok = loadConfig({ NODE_ENV: 'production', HOST_TOKEN: 'a'.repeat(24) });
    expect(ok.hostTokenIsDefault).toBe(false);
    expect(ok.corsOrigins).toEqual([]);
  });

  it('geçersiz port reddedilir', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/PORT/);
    expect(() => loadConfig({ PORT: '70000' })).toThrow(/PORT/);
    expect(loadConfig({ PORT: '8080' }).port).toBe(8080);
  });

  it('hatalı CORS adresi ve TikTok kullanıcı adı açıkça raporlanır', () => {
    expect(() => loadConfig({ CORS_ORIGINS: 'ftp://x.com' })).toThrow(/CORS_ORIGINS/);
    expect(() => loadConfig({ TIKTOK_ENABLED: '1', TIKTOK_UNIQUE_ID: 'a b!' })).toThrow(/TIKTOK_UNIQUE_ID/);
  });

  it('birden fazla hata birlikte raporlanır', () => {
    try {
      loadConfig({ NODE_ENV: 'production', PORT: 'x', CORS_ORIGINS: 'bozuk' });
      throw new Error('hata bekleniyordu');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toMatch(/PORT/);
      expect(msg).toMatch(/HOST_TOKEN/);
      expect(msg).toMatch(/CORS_ORIGINS/);
    }
  });

  it('TikTok açıkken kullanıcı adındaki @ temizlenir', () => {
    const c = loadConfig({ TIKTOK_ENABLED: '1', TIKTOK_UNIQUE_ID: '@yayinci_1', SIGN_API_KEY: ' k ' });
    expect(c.tiktok).toEqual({ uniqueId: 'yayinci_1', signApiKey: 'k' });
  });

  it('OVERLAY_DIST yoksa hata verir', () => {
    expect(() => loadConfig({ OVERLAY_DIST: '/bu/yol/yok' })).toThrow(/OVERLAY_DIST/);
  });
});
