import { afterEach, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import type { AckResult, HelloResult, HostStatus, InitMessage } from '@ttl/game-core';
import { createApp, type App } from '../src/app';

const HOST = 'control-test-host';

let app: App | null = null;
const sockets: Socket[] = [];

afterEach(async () => {
  for (const s of sockets) s.disconnect();
  sockets.length = 0;
  if (app) await app.close();
  app = null;
});

function call<T>(s: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve) => s.emit(event, payload, (res: T) => resolve(res)));
}

function connect(opts: { room?: string } = {}): Promise<{ socket: Socket; init: InitMessage }> {
  return new Promise((resolve, reject) => {
    const socket = io(app!.url(), {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      auth: opts.room === undefined ? {} : { room: opts.room },
    });
    sockets.push(socket);
    socket.once('init', (init: InitMessage) => resolve({ socket, init }));
    socket.once('connect_error', reject);
  });
}

async function setup(): Promise<{ a: Socket; b: Socket; roomId: string }> {
  app = await createApp({ port: 0, hostToken: HOST, corsOrigins: [], seed: 41, giftDbPath: ':memory:' });
  const a = await connect();
  const b = await connect();
  return { a: a.socket, b: b.socket, roomId: a.init.roomId };
}

async function waitFor(pred: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('zaman aşımı');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('oda kimliği', () => {
  it('yanlış oda kimliğiyle overlay bağlantısı reddedilir, doğru kimlikle kabul edilir', async () => {
    const { roomId } = await setup();
    await expect(connect({ room: 'eski-oda' })).rejects.toThrow('room_mismatch');
    const ok = await connect({ room: roomId });
    expect(ok.init.roomId).toBe(roomId);
  });

  it('yeni oda oluşturulunca oda kimliği değişir ve eski kimlik geçersiz olur', async () => {
    const { a, roomId } = await setup();
    expect(await call<AckResult>(a, 'host:reset', { token: HOST })).toEqual({ ok: true });
    const status = await call<{ ok: true } & HostStatus>(a, 'host:status', { token: HOST });
    expect(status.roomId).not.toBe(roomId);
    await expect(connect({ room: roomId })).rejects.toThrow('room_mismatch');
  });
});

describe('yayıncı kontrolleri', () => {
  it('yetkisiz istekler reddedilir', async () => {
    const { a } = await setup();
    expect(await call<AckResult>(a, 'host:stop', { token: 'x' })).toEqual({ ok: false, reason: 'unauthorized' });
    expect(await call<AckResult>(a, 'host:block', { token: 'x', name: 'Ali' })).toEqual({
      ok: false,
      reason: 'unauthorized',
    });
  });

  it('maç yokken durdurma reddedilir, maç durdurulunca kazanansız biter', async () => {
    const { a, b } = await setup();
    expect(await call<AckResult>(a, 'host:stop', { token: HOST })).toEqual({ ok: false, reason: 'not_playing' });
    await call(a, 'hello', { name: 'Ali' });
    await call(b, 'hello', { name: 'Ayşe' });
    await call(a, 'host:start', { token: HOST });
    expect(await call<AckResult>(a, 'host:stop', { token: HOST })).toEqual({ ok: true });
    await waitFor(() => app!.room.world.phase === 'ended');
    expect(app!.room.world.winner).toBeNull();
    expect(app!.room.world.winReason).toBe('host-stopped');
  });

  it('zorluk lobide ayarlanır, maç başladıktan sonra değişmez', async () => {
    const { a, b } = await setup();
    expect(await call<AckResult>(a, 'host:difficulty', { token: HOST, difficulty: 'hard' })).toEqual({ ok: true });
    expect(await call<AckResult>(a, 'host:difficulty', { token: HOST, difficulty: 'extreme' })).toEqual({
      ok: false,
      reason: 'invalid_request',
    });
    await call(a, 'hello', { name: 'Ali' });
    await call(b, 'hello', { name: 'Ayşe' });
    await call(a, 'host:start', { token: HOST });
    expect(await call<AckResult>(a, 'host:difficulty', { token: HOST, difficulty: 'easy' })).toEqual({
      ok: false,
      reason: 'match_already_started',
    });
    expect(app!.room.world.difficulty).toBe('hard');
  });

  it('lobideki engellenen oyuncu çıkarılır, yeniden katılamaz, engel kaldırılınca katılabilir', async () => {
    const { a, b } = await setup();
    await call(a, 'hello', { name: 'Ali' });
    await call(b, 'hello', { name: 'Ayşe' });
    expect(app!.room.world.players.ali).toBeDefined();

    expect(await call<AckResult>(a, 'host:block', { token: HOST, name: 'ali' })).toEqual({ ok: true });
    expect(app!.room.world.players.ali).toBeUndefined();
    expect(await call<HelloResult>(a, 'hello', { name: 'Ali' })).toEqual({ ok: false, reason: 'blocked' });
    expect(app!.room.submitChat('Ali', 'GİR')).toEqual({ ok: false, reason: 'blocked' });

    const status = await call<{ ok: true } & HostStatus>(a, 'host:status', { token: HOST });
    expect(status.blocked.map((x) => x.name)).toContain('Ali');

    expect(await call<AckResult>(a, 'host:unblock', { token: HOST, name: 'Ali' })).toEqual({ ok: true });
    expect(await call<HelloResult>(a, 'hello', { name: 'Ali' })).toMatchObject({ ok: true });
  });

  it('maçtaki engellenen oyuncunun komutları ve hediyeleri kabul edilmez', async () => {
    const { a, b } = await setup();
    await call(a, 'hello', { name: 'Ali' });
    await call(b, 'hello', { name: 'Ayşe' });
    await call(a, 'host:start', { token: HOST });
    await call(a, 'host:block', { token: HOST, name: 'Ali' });
    expect(app!.room.submitChat('Ali', 'SOL')).toEqual({ ok: false, reason: 'blocked' });
    expect(app!.room.submitGift('Ali', 'Gül')).toEqual({ ok: false, reason: 'blocked' });
  });

  it('yeni oda engel listesini temizler', async () => {
    const { a, b } = await setup();
    await call(a, 'host:block', { token: HOST, name: 'Ali' });
    await call(b, 'hello', { name: 'Ayşe' });
    await call(a, 'host:reset', { token: HOST });
    const status = await call<{ ok: true } & HostStatus>(a, 'host:status', { token: HOST });
    expect(status.blocked).toEqual([]);
    expect(await call<HelloResult>(a, 'hello', { name: 'Ali' })).toMatchObject({ ok: true });
  });
});
