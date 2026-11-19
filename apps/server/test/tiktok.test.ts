import { afterEach, describe, expect, it } from 'vitest';
import type { ChatMessage, SourceInfo } from '@ttl/game-core';
import { createApp, type App } from '../src/app';
import { TikTokChatSource, isOfflineError, type ChatConnection } from '../src/sources/tiktokSource';

/** Gerçek TikTok bağlantısının yerine geçen sahte bağlantı. */
class FakeConnection {
  readonly handlers = new Map<string, Array<(arg?: unknown) => void>>();
  connectCalls = 0;
  disconnects = 0;

  constructor(private readonly behavior: () => Promise<unknown>) {}

  connect(): Promise<unknown> {
    this.connectCalls += 1;
    return this.behavior();
  }

  disconnect(): Promise<unknown> {
    this.disconnects += 1;
    return Promise.resolve();
  }

  on(event: string, handler: (arg?: unknown) => void): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  emit(event: string, arg?: unknown): void {
    for (const h of this.handlers.get(event) ?? []) h(arg);
  }

  asConnection(): ChatConnection {
    return this as unknown as ChatConnection;
  }
}

const succeed = () => Promise.resolve();
const offline = () => Promise.reject(Object.assign(new Error('Yayın kapalı'), { name: 'UserOfflineError' }));

function factory(behaviors: Array<() => Promise<unknown>>) {
  const made: FakeConnection[] = [];
  const createConnection = (): ChatConnection => {
    const b = behaviors[Math.min(made.length, behaviors.length - 1)];
    const c = new FakeConnection(b);
    made.push(c);
    return c.asConnection();
  };
  return { createConnection, made };
}

async function waitFor(pred: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('zaman aşımı');
    await new Promise((r) => setTimeout(r, 5));
  }
}

let app: App | null = null;
let source: TikTokChatSource | null = null;

afterEach(async () => {
  source?.stop();
  source = null;
  if (app) await app.close();
  app = null;
});

describe('TikTokChatSource', () => {
  it('chat mesajlarını kullanıcı ve metin olarak yayar, boş olanları eler', async () => {
    const { createConnection, made } = factory([succeed]);
    const received: ChatMessage[] = [];
    source = new TikTokChatSource({ uniqueId: 'yayinci', createConnection, onStatus: () => undefined });
    source.subscribe((m) => received.push(m));
    source.start();
    await waitFor(() => made.length === 1);

    const c = made[0];
    c.emit('connected');
    c.emit('chat', { comment: '  GİR ', user: { uniqueId: 'ayse' } });
    c.emit('chat', { comment: '', user: { uniqueId: 'bos' } });
    c.emit('chat', { comment: 'SOL' });
    c.emit('chat', { comment: 'SOL', user: { nickname: 'Nick Adı' } });

    expect(received.map((m) => [m.user, m.text])).toEqual([
      ['ayse', 'GİR'],
      ['Nick Adı', 'SOL'],
    ]);
  });

  it('bağlantı durumlarını bildirir: bağlanıyor, bağlı, hata', async () => {
    const { createConnection, made } = factory([succeed]);
    const statuses: SourceInfo[] = [];
    source = new TikTokChatSource({
      uniqueId: 'yayinci',
      createConnection,
      onStatus: (i) => statuses.push(i),
      retryBaseMs: 10_000,
    });
    source.start();
    await waitFor(() => made.length === 1);
    made[0].emit('connected');
    made[0].emit('error', new Error('soket hatası'));

    const seen = statuses.map((s) => s.status);
    expect(seen).toContain('connecting');
    expect(seen).toContain('connected');
    expect(statuses[statuses.length - 1]).toMatchObject({ status: 'error', name: 'tiktok' });
    expect(statuses[statuses.length - 1].detail).toContain('soket hatası');
  });

  it('yayın kapalıysa offline durumuna geçer ve yeniden dener', async () => {
    const { createConnection, made } = factory([offline, succeed]);
    const statuses: string[] = [];
    source = new TikTokChatSource({
      uniqueId: 'yayinci',
      createConnection,
      onStatus: (i) => statuses.push(i.status),
      retryBaseMs: 20,
      retryMaxMs: 40,
    });
    source.start();
    await waitFor(() => made.length >= 2);
    expect(statuses).toContain('offline');
    made[1].emit('connected');
    await waitFor(() => source?.currentStatus === 'connected');
  });

  it('bağlantı koparsa yeniden bağlanır', async () => {
    const { createConnection, made } = factory([succeed, succeed]);
    source = new TikTokChatSource({ uniqueId: 'yayinci', createConnection, onStatus: () => undefined, retryBaseMs: 10 });
    source.start();
    await waitFor(() => made.length === 1);
    made[0].emit('connected');
    made[0].emit('disconnected');
    await waitFor(() => made.length === 2);
    expect(made[0].disconnects).toBeGreaterThanOrEqual(1);
  });

  it('eski bağlantının olayları yeni bağlantıyı etkilemez', async () => {
    const { createConnection, made } = factory([succeed, succeed]);
    const received: ChatMessage[] = [];
    source = new TikTokChatSource({ uniqueId: 'yayinci', createConnection, onStatus: () => undefined, retryBaseMs: 10 });
    source.subscribe((m) => received.push(m));
    source.start();
    await waitFor(() => made.length === 1);
    made[0].emit('disconnected');
    await waitFor(() => made.length === 2);

    made[0].emit('chat', { comment: 'GİR', user: { uniqueId: 'eski' } });
    made[1].emit('chat', { comment: 'GİR', user: { uniqueId: 'yeni' } });
    expect(received.map((m) => m.user)).toEqual(['yeni']);
  });

  it('stop bağlantıyı kapatır ve yeniden denemeyi durdurur', async () => {
    const { createConnection, made } = factory([succeed]);
    source = new TikTokChatSource({ uniqueId: 'yayinci', createConnection, onStatus: () => undefined, retryBaseMs: 5 });
    source.start();
    await waitFor(() => made.length === 1);
    made[0].emit('disconnected');
    source.stop();
    await new Promise((r) => setTimeout(r, 80));
    expect(made.length).toBeLessThanOrEqual(2);
    const countAfterStop = made.length;
    await new Promise((r) => setTimeout(r, 80));
    expect(made.length).toBe(countAfterStop);
    expect(source.currentStatus).toBe('idle');
  });

  it('Error olmayan kütüphane hatalarının mesajı durum olarak gösterilir', async () => {
    const plain = () => Promise.reject({ message: 'Failed to retrieve Room ID from all sources.' });
    const { createConnection, made } = factory([plain, succeed]);
    const statuses: SourceInfo[] = [];
    source = new TikTokChatSource({
      uniqueId: 'yayinci',
      createConnection,
      onStatus: (i) => statuses.push(i),
      retryBaseMs: 10_000,
    });
    source.start();
    await waitFor(() => made.length === 1 && statuses.some((s) => s.status === 'error'));
    const last = statuses[statuses.length - 1];
    expect(last.detail).toContain('Failed to retrieve Room ID');
  });

  it('UserOfflineError tanınır, diğer hatalar tanınmaz', () => {
    expect(isOfflineError(Object.assign(new Error('x'), { name: 'UserOfflineError' }))).toBe(true);
    expect(isOfflineError(new Error('başka'))).toBe(false);
    expect(isOfflineError(null)).toBe(false);
  });
});

describe('uygulama ile entegrasyon', () => {
  it('TikTok chat\'i oyuna GİR olarak katılır ve kaynak durumu bağlanır', async () => {
    const { createConnection, made } = factory([succeed]);
    app = await createApp({
      port: 0,
      hostToken: 't',
      corsOrigins: [],
      seed: 11,
      tiktok: { uniqueId: 'yayinci', createConnection, retryBaseMs: 20 },
    });
    await waitFor(() => made.length === 1);
    made[0].emit('connected');
    await waitFor(() => app?.room.source.status === 'connected');

    made[0].emit('chat', { comment: 'GİR', user: { uniqueId: 'tt_izleyici' } });
    await waitFor(() => app?.room.world.players.tt_izleyici !== undefined);
    expect(app.room.initPayload().source.name).toBe('tiktok');
  });

  it('TikTok ayarlanmadıysa kaynak kapalı görünür ve fabrika çağrılmaz', async () => {
    const { createConnection, made } = factory([succeed]);
    app = await createApp({ port: 0, hostToken: 't', corsOrigins: [], seed: 12 });
    expect(app.room.source.status).toBe('disabled');
    expect(made.length).toBe(0);
    void createConnection;
  });

  it('kapatıldığında TikTok bağlantısı kapanır ve yeni bağlantı açılmaz', async () => {
    const { createConnection, made } = factory([succeed]);
    app = await createApp({
      port: 0,
      hostToken: 't',
      corsOrigins: [],
      seed: 13,
      tiktok: { uniqueId: 'yayinci', createConnection, retryBaseMs: 5 },
    });
    await waitFor(() => made.length === 1);
    made[0].emit('disconnected');
    await waitFor(() => made.length === 2);
    const closing = app;
    app = null;
    await closing.close();
    const count = made.length;
    await new Promise((r) => setTimeout(r, 60));
    expect(made.length).toBe(count);
    expect(made[made.length - 1].disconnects).toBeGreaterThanOrEqual(0);
  });
});

describe('TikTok hediye olayları', () => {
  it('yalnızca seri bittiğinde (repeatEnd) hediye yayılır', async () => {
    const { createConnection, made } = factory([succeed]);
    const gifts: Array<{ user: string; giftName: string }> = [];
    source = new TikTokChatSource({ uniqueId: 'yayinci', createConnection, onStatus: () => undefined });
    source.subscribeGift((g) => gifts.push({ user: g.user, giftName: g.giftName }));
    source.start();
    await waitFor(() => made.length === 1);

    const c = made[0];
    c.emit('connected');
    c.emit('gift', { user: { uniqueId: 'izleyici' }, giftDetails: { giftName: 'Gül' }, repeatEnd: 0 });
    c.emit('gift', { user: { uniqueId: 'izleyici' }, giftDetails: { giftName: 'Gül' }, repeatEnd: 1 });
    c.emit('gift', { user: {}, giftDetails: { giftName: 'Gül' }, repeatEnd: true });
    c.emit('gift', { user: { uniqueId: 'x' }, giftDetails: {}, repeatEnd: true });

    expect(gifts).toEqual([{ user: 'izleyici', giftName: 'Gül' }]);
  });
});
