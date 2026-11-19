import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import type { AckResult, GiftEntry, GiftTier, HelloResult } from '@ttl/game-core';
import { createApp, type App } from '../src/app';
import { GiftStore, giftKey, isTier } from '../src/giftStore';

const HOST = 'gift-test-host';

describe('GiftStore', () => {
  it('ilk kurulumda örnek eşlemeleri ekler ve büyük/küçük harfi yok sayar', () => {
    const store = new GiftStore(':memory:');
    expect(store.list()).toHaveLength(4);
    expect(store.resolve('Gül')).toBe('small');
    expect(store.resolve('  gÜL  ')).toBe('small');
    expect(store.resolve('Bilinmeyen')).toBeUndefined();
    store.close();
  });

  it('ekleme ve güncelleme çalışır, geçersiz kademe reddedilir', () => {
    const store = new GiftStore(':memory:');
    expect(store.set('Kuş', 'big')).toBe(true);
    expect(store.resolve('kuş')).toBe('big');
    expect(store.set('Kuş', 'special')).toBe(true);
    expect(store.resolve('KUŞ')).toBe('special');
    expect(store.set('Geçersiz', 'huge' as GiftTier)).toBe(false);
    expect(store.set('   ', 'small')).toBe(false);
    expect(store.resolve('Geçersiz')).toBeUndefined();
    store.close();
  });

  it('silme çalışır ve silinen hediye artık çözülmez', () => {
    const store = new GiftStore(':memory:');
    expect(store.remove('Gül')).toBe(true);
    expect(store.remove('Gül')).toBe(false);
    expect(store.resolve('Gül')).toBeUndefined();
    store.close();
  });

  it('dosyaya kaydedilen eşlemeler yeniden açılınca korunur, örnekler tekrar eklenmez', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ttl-gifts-'));
    const file = join(dir, 'gifts.db');
    try {
      const a = new GiftStore(file);
      a.set('Yeni Hediye', 'medium');
      a.remove('Gül');
      a.close();

      const b = new GiftStore(file);
      expect(b.resolve('yeni hediye')).toBe('medium');
      expect(b.resolve('Gül')).toBeUndefined();
      const names = b.list().map((g: GiftEntry) => g.name);
      expect(names).not.toContain('Gül');
      b.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('yardımcılar: anahtar ve kademe doğrulama', () => {
    expect(giftKey('  Aşık   Kalp ')).toBe('aşık kalp');
    expect(isTier('big')).toBe(true);
    expect(isTier('huge')).toBe(false);
    expect(isTier(undefined)).toBe(false);
  });
});

describe('hediye akışı (soket)', () => {
  let app: App | null = null;
  const sockets: Socket[] = [];

  afterEach(async () => {
    for (const s of sockets) s.disconnect();
    sockets.length = 0;
    if (app) await app.close();
    app = null;
  });

  async function setup(): Promise<{ url: string; a: Socket; b: Socket }> {
    app = await createApp({ port: 0, hostToken: HOST, corsOrigins: [], seed: 21, giftDbPath: ':memory:' });
    const url = app.url();
    const connect = () =>
      new Promise<Socket>((resolve) => {
        const s = io(url, { transports: ['websocket'], forceNew: true, reconnection: false });
        sockets.push(s);
        s.once('connect', () => resolve(s));
      });
    const a = await connect();
    const b = await connect();
    return { url, a, b };
  }

  function call<T>(s: Socket, event: string, payload: unknown): Promise<T> {
    return new Promise((resolve) => s.emit(event, payload, (res: T) => resolve(res)));
  }

  async function waitFor(pred: () => boolean, timeoutMs = 3000): Promise<void> {
    const start = Date.now();
    while (!pred()) {
      if (Date.now() - start > timeoutMs) throw new Error('zaman aşımı');
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  it('yayıncı dışındaki hediye yönetimi reddedilir', async () => {
    const { a } = await setup();
    expect(await call<AckResult>(a, 'host:gift', { token: 'x', user: 'Ali', giftName: 'Gül' })).toEqual({
      ok: false,
      reason: 'unauthorized',
    });
    expect(await call<AckResult>(a, 'host:gift:set', { token: 'x', name: 'Kuş', tier: 'big' })).toEqual({
      ok: false,
      reason: 'unauthorized',
    });
  });

  it('eşlemesi olmayan hediye reddedilir, eşleme eklenince kabul edilir', async () => {
    const { a, b } = await setup();
    await call(a, 'hello', { name: 'Ali' });
    await call(b, 'hello', { name: 'Ayşe' });
    await call(a, 'host:start', { token: HOST });

    expect(await call<AckResult>(a, 'host:gift', { token: HOST, user: 'Ali', giftName: 'Kuş' })).toEqual({
      ok: false,
      reason: 'unknown_gift',
    });
    expect(await call<AckResult>(a, 'host:gift:set', { token: HOST, name: 'Kuş', tier: 'big' })).toEqual({ ok: true });
    expect(await call<AckResult>(a, 'host:gift', { token: HOST, user: 'Ali', giftName: 'kuş' })).toEqual({ ok: true });
  });

  it('küçük hediye gönderen oyuncuya hız bonusu verir', async () => {
    const { a, b } = await setup();
    await call(a, 'hello', { name: 'Ali' });
    await call(b, 'hello', { name: 'Ayşe' });
    await call(a, 'host:start', { token: HOST });
    await call(a, 'host:gift', { token: HOST, user: 'Ali', giftName: 'Gül' });
    await waitFor(() => (app?.room.world.players.ali?.speedTicks ?? 0) > 0);
  });

  it('hediye listesi döner ve silinen eşleme artık çalışmaz', async () => {
    const { a } = await setup();
    const listed = await call<{ ok: boolean; gifts: GiftEntry[] }>(a, 'host:gifts', { token: HOST });
    expect(listed.ok).toBe(true);
    expect(listed.gifts.map((g) => g.name)).toContain('Gül');
    expect(await call<AckResult>(a, 'host:gift:delete', { token: HOST, name: 'Gül' })).toEqual({ ok: true });
    await call(a, 'hello', { name: 'Ali' });
    expect(await call<AckResult>(a, 'host:gift', { token: HOST, user: 'Ali', giftName: 'Gül' })).toEqual({
      ok: false,
      reason: 'unknown_gift',
    });
  });

  it('geçersiz kademe ile eşleme kaydedilmez', async () => {
    const { a } = await setup();
    expect(await call<AckResult>(a, 'host:gift:set', { token: HOST, name: 'Kuş', tier: 'huge' })).toEqual({
      ok: false,
      reason: 'invalid_request',
    });
  });

  it('hello dönüşü tip kontrolü (katılım tipi)', async () => {
    const { a } = await setup();
    const r = await call<HelloResult>(a, 'hello', { name: 'Ali' });
    expect(r.ok).toBe(true);
  });
});
