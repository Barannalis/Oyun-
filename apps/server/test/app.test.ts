import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { MAX_PLAYERS, type AckResult, type EventsMessage, type HelloResult, type InitMessage, type StateMessage } from '@ttl/game-core';
import { createApp, type App } from '../src/app';

const HOST = 'test-host-token';
const GRACE_MS = 200;

interface Feed {
  socket: Socket;
  inits: InitMessage[];
  states: StateMessage[];
  events: EventsMessage[];
}

let app: App;
let url: string;
const feeds: Feed[] = [];

function connect(): Promise<Feed> {
  return new Promise((resolve, reject) => {
    const socket = io(url, { transports: ['websocket'], forceNew: true, reconnection: false });
    const feed: Feed = { socket, inits: [], states: [], events: [] };
    socket.on('init', (m: InitMessage) => feed.inits.push(m));
    socket.on('state', (m: StateMessage) => feed.states.push(m));
    socket.on('events', (m: EventsMessage) => feed.events.push(m));
    socket.once('connect', () => resolve(feed));
    socket.once('connect_error', reject);
    feeds.push(feed);
  });
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

const EMPTY_STATE = {
  seed: 0,
  tick: 0,
  phase: 'lobby',
  players: {},
  generators: [],
  winner: null,
  winReason: null,
} as StateMessage['state'];

/** Henüz durum gelmediyse boş lobi döner, böylece waitFor tekrar dener. */
function latestState(feed: Feed): StateMessage['state'] {
  return feed.states[feed.states.length - 1]?.state ?? EMPTY_STATE;
}

beforeEach(async () => {
  app = await createApp({
    port: 0,
    hostToken: HOST,
    corsOrigins: [],
    seed: 7,
    reconnectGraceMs: GRACE_MS,
  });
  url = app.url();
});

afterEach(async () => {
  for (const f of feeds) f.socket.disconnect();
  feeds.length = 0;
  await app.close();
});

describe('bağlantı ve katılım', () => {
  it('her bağlantı harita ve ilk durumu alır', async () => {
    const a = await connect();
    await waitFor(() => a.inits.length === 1);
    expect(a.inits[0].map.tiles.length).toBe(a.inits[0].map.width * a.inits[0].map.height);
    expect(a.inits[0].state.phase).toBe('lobby');
  });

  it('kullanıcı adıyla katılır ve token alır', async () => {
    const a = await connect();
    const r = await call<HelloResult>(a.socket, 'hello', { name: 'Ali' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.key).toBe('ali');
    expect(r.token.length).toBeGreaterThan(10);
    await waitFor(() => latestState(a).players.ali !== undefined);
  });

  it('aynı adı farklı büyük/küçük harfle de olsa ikinci kez alamaz', async () => {
    const a = await connect();
    const b = await connect();
    await call(a.socket, 'hello', { name: 'Ali' });
    const r = await call<HelloResult>(b.socket, 'hello', { name: 'ALİ' });
    expect(r).toEqual({ ok: false, reason: 'name_taken' });
  });

  it('boş ad ve bozuk istek reddedilir', async () => {
    const a = await connect();
    expect(await call(a.socket, 'hello', { name: '   ' })).toEqual({ ok: false, reason: 'invalid_name' });
    expect(await call(a.socket, 'hello', { name: 42 })).toEqual({ ok: false, reason: 'invalid_request' });
    expect(await call(a.socket, 'hello', null)).toEqual({ ok: false, reason: 'invalid_request' });
  });

  it('en fazla MAX_PLAYERS oyuncu kabul edilir, fazlası room_full alır', async () => {
    const accepted: boolean[] = [];
    for (let i = 0; i < MAX_PLAYERS + 1; i++) {
      const f = await connect();
      const r = await call<HelloResult>(f.socket, 'hello', { name: `oyuncu${i}` });
      accepted.push(r.ok);
      if (!r.ok) expect(r.reason).toBe('room_full');
    }
    expect(accepted.filter(Boolean)).toHaveLength(MAX_PLAYERS);
  });

  it('katılım bildirimi olay olarak yayınlanır', async () => {
    const a = await connect();
    const obs = await connect();
    await call(a.socket, 'hello', { name: 'Ali' });
    await waitFor(() => obs.events.some((m) => m.events.some((e) => e.type === 'joined' && e.key === 'ali')));
  });
});

describe('yeniden bağlanma', () => {
  it('token ile aynı oyuncu geri bağlanır', async () => {
    const a = await connect();
    const first = await call<HelloResult>(a.socket, 'hello', { name: 'Ayşe' });
    a.socket.disconnect();

    const b = await connect();
    const again = await call<HelloResult>(b.socket, 'hello', { name: 'Ayşe', token: first.ok ? first.token : '' });
    expect(again.ok).toBe(true);
    if (again.ok && first.ok) expect(again.key).toBe(first.key);
    await waitFor(() => latestState(b).players.ayşe?.connected === true);
  });

  it('eski soketin kopması, yeniden bağlanmış oyuncuyu etkilemez', async () => {
    const a = await connect();
    const first = await call<HelloResult>(a.socket, 'hello', { name: 'Ali' });
    const b = await connect();
    await call(b.socket, 'hello', { name: 'Ali', token: first.ok ? first.token : '' });

    a.socket.disconnect();
    await new Promise((r) => setTimeout(r, GRACE_MS + 150));
    await waitFor(() => latestState(b).players.ali !== undefined);
    expect(latestState(b).players.ali.connected).toBe(true);
  });

  it('lobide bağlantısı kopan oyuncu süre dolunca silinir', async () => {
    const a = await connect();
    const obs = await connect();
    await call(a.socket, 'hello', { name: 'Can' });
    await waitFor(() => latestState(obs).players.can !== undefined);
    a.socket.disconnect();
    await waitFor(() => latestState(obs).players.can === undefined, GRACE_MS + 2000);
  });
});

describe('maç ve yayıncı paneli', () => {
  it('yanlış host token ile başlatma reddedilir', async () => {
    const a = await connect();
    expect(await call<AckResult>(a.socket, 'host:start', { token: 'yanlış' })).toEqual({ ok: false, reason: 'unauthorized' });
  });

  it('yeterli oyuncuyla maç başlar, tekrar başlatma reddedilir', async () => {
    const a = await connect();
    const b = await connect();
    await call(a.socket, 'hello', { name: 'Ali' });
    await call(b.socket, 'hello', { name: 'Ayşe' });
    expect(await call<AckResult>(a.socket, 'host:start', { token: HOST })).toEqual({ ok: true });
    await waitFor(() => latestState(b).phase === 'playing');
    expect(await call<AckResult>(a.socket, 'host:start', { token: HOST })).toEqual({
      ok: false,
      reason: 'match_already_started',
    });
  });

  it('tek oyuncuyla maç başlamaz', async () => {
    const a = await connect();
    await call(a.socket, 'hello', { name: 'Yalnız' });
    expect(await call<AckResult>(a.socket, 'host:start', { token: HOST })).toEqual({
      ok: false,
      reason: 'not_enough_players',
    });
  });

  it('maç başladıktan sonra yeni oyuncu katılamaz', async () => {
    const a = await connect();
    const b = await connect();
    await call(a.socket, 'hello', { name: 'Ali' });
    await call(a.socket, 'hello', { name: 'Ali2' });
    await call(a.socket, 'host:start', { token: HOST });
    const late = await connect();
    expect(await call<HelloResult>(late.socket, 'hello', { name: 'Geç' })).toEqual({
      ok: false,
      reason: 'match_in_progress',
    });
    void b;
  });

  it('yorum hız sınırı spam komutlarını kısar', async () => {
    const a = await connect();
    const b = await connect();
    await call(a.socket, 'hello', { name: 'Ali' });
    await call(b.socket, 'hello', { name: 'Ayşe' });
    await call(a.socket, 'host:start', { token: HOST });

    const results: AckResult[] = [];
    for (let i = 0; i < 12; i++) {
      results.push(await call<AckResult>(a.socket, 'command', { text: 'SOL' }));
    }
    const limited = results.filter((r) => !r.ok && r.reason === 'rate_limited').length;
    expect(limited).toBeGreaterThanOrEqual(4);
  });

  it('bilinmeyen yorum tanınmayan komut olarak döner', async () => {
    const a = await connect();
    await call(a.socket, 'hello', { name: 'Ali' });
    expect(await call<AckResult>(a.socket, 'command', { text: 'merhaba dünya' })).toEqual({
      ok: false,
      reason: 'unknown_command',
    });
  });

  it('katılmamış soket komut veremez', async () => {
    const a = await connect();
    expect(await call<AckResult>(a.socket, 'command', { text: 'SOL' })).toEqual({ ok: false, reason: 'not_joined' });
  });

  it('host:chat ile gelen yorum lobiye GİR ile katılır', async () => {
    const a = await connect();
    expect(await call<AckResult>(a.socket, 'host:chat', { token: 'x', user: 'Zeynep', text: 'GİR' })).toEqual({
      ok: false,
      reason: 'unauthorized',
    });
    expect(await call<AckResult>(a.socket, 'host:chat', { token: HOST, user: 'Zeynep', text: 'GİR' })).toEqual({
      ok: true,
    });
    await waitFor(() => latestState(a).players.zeynep !== undefined);
  });

  it('host:reset yeni harita yayınlar ve kimlikleri temizler', async () => {
    const a = await connect();
    const b = await connect();
    await call(a.socket, 'hello', { name: 'Ali' });
    await waitFor(() => latestState(b).players.ali !== undefined);
    const before = b.inits.length;
    expect(await call<AckResult>(a.socket, 'host:reset', { token: HOST })).toEqual({ ok: true });
    await waitFor(() => b.inits.length > before && Object.keys(latestState(b).players).length === 0);
    expect(Object.keys(latestState(b).players)).toHaveLength(0);
    expect(b.inits[b.inits.length - 1].state.phase).toBe('lobby');
  });
});
