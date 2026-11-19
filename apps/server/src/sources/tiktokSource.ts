import type { ChatMessage, ChatSource, GiftMessage, SourceInfo, SourceStatus } from '@ttl/game-core';

/**
 * Adaptörün ihtiyaç duyduğu minimum bağlantı arayüzü. tiktok-live-connector'ın
 * TikTokLiveConnection sınıfı bunu karşılar. Testlerde sahte bir uygulama kullanılır.
 */
export interface ChatPayload {
  comment: string;
  user?: { uniqueId?: string; nickname?: string };
}

export interface GiftPayload {
  user?: { uniqueId?: string; nickname?: string };
  giftDetails?: { giftName?: string };
  /** Seri hediyelerde son paket 1 (veya true) olur. Yalnızca o paket sayılır. */
  repeatEnd?: number | boolean;
}

export interface ChatConnection {
  connect(): Promise<unknown>;
  disconnect(): Promise<unknown>;
  on(event: 'chat', handler: (data: ChatPayload) => void): void;
  on(event: 'gift', handler: (data: GiftPayload) => void): void;
  on(event: 'connected' | 'disconnected', handler: () => void): void;
  on(event: 'error', handler: (err: unknown) => void): void;
}

export interface TikTokSourceOptions {
  uniqueId: string;
  createConnection: (uniqueId: string) => ChatConnection;
  onStatus: (info: SourceInfo) => void;
  retryBaseMs?: number;
  retryMaxMs?: number;
}

const SOURCE_NAME = 'tiktok';

/**
 * TikTok LIVE yorumlarını ChatSource olarak yayar. Resmi bir API olmadığı için
 * bağlantı kopması ve yayın kapalılığı durumları üssel geri çekilmeyle yeniden denenir.
 *
 * Bu adaptör sistemin zorunlu parçası değildir. Oyun, yalnızca yayıncı panelindeki
 * simülatörle de tam çalışır.
 */
export class TikTokChatSource implements ChatSource {
  readonly name = SOURCE_NAME;
  private readonly handlers = new Set<(message: ChatMessage) => void>();
  private readonly giftHandlers = new Set<(message: GiftMessage) => void>();
  private conn: ChatConnection | null = null;
  private running = false;
  private attempts = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private status: SourceStatus = 'idle';
  private lastEmitted = '';

  constructor(private readonly opts: TikTokSourceOptions) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.attempts = 0;
    this.connect();
  }

  stop(): void {
    this.running = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const c = this.conn;
    this.conn = null;
    if (c) void c.disconnect().catch(() => undefined);
    this.setStatus('idle');
  }

  subscribe(handler: (message: ChatMessage) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  subscribeGift(handler: (message: GiftMessage) => void): () => void {
    this.giftHandlers.add(handler);
    return () => {
      this.giftHandlers.delete(handler);
    };
  }

  private connect(): void {
    const c = this.opts.createConnection(this.opts.uniqueId);
    this.conn = c;
    this.setStatus('connecting');

    c.on('chat', (data) => {
      if (this.conn !== c) return;
      const user = data.user?.uniqueId || data.user?.nickname || '';
      const text = typeof data.comment === 'string' ? data.comment.trim() : '';
      if (user.length === 0 || text.length === 0) return;
      const message: ChatMessage = { user, text, receivedAt: Date.now() };
      for (const h of this.handlers) h(message);
    });
    c.on('gift', (data) => {
      if (this.conn !== c) return;
      if (!data.repeatEnd) return;
      const user = data.user?.uniqueId || data.user?.nickname || '';
      const giftName = data.giftDetails?.giftName?.trim() ?? '';
      if (user.length === 0 || giftName.length === 0) return;
      const message: GiftMessage = { user, giftName, receivedAt: Date.now() };
      for (const h of this.giftHandlers) h(message);
    });
    c.on('connected', () => {
      if (this.conn !== c) return;
      this.attempts = 0;
      this.setStatus('connected');
    });
    c.on('disconnected', () => {
      if (this.conn !== c) return;
      this.scheduleRetry('Bağlantı koptu');
    });
    c.on('error', (err) => {
      if (this.conn !== c) return;
      this.scheduleRetry(describe(err));
    });

    c.connect().catch((err: unknown) => {
      if (this.conn !== c) return;
      this.scheduleRetry(describe(err), isOfflineError(err));
    });
  }

  private scheduleRetry(detail: string, offline = false): void {
    if (!this.running || this.retryTimer) return;
    const old = this.conn;
    this.conn = null;
    if (old) void old.disconnect().catch(() => undefined);

    const base = this.opts.retryBaseMs ?? 5_000;
    const max = this.opts.retryMaxMs ?? 60_000;
    const delay = Math.min(max, base * 2 ** this.attempts);
    this.attempts += 1;

    const seconds = Math.round(delay / 1000);
    this.setStatus(offline ? 'offline' : 'error', `${detail}. ${seconds > 0 ? `${seconds} sn` : 'kısa süre'} sonra tekrar denenecek`);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.running) this.connect();
    }, delay);
  }

  private setStatus(status: SourceStatus, detail?: string): void {
    this.status = status;
    const key = `${status}|${detail ?? ''}`;
    if (key === this.lastEmitted) return;
    this.lastEmitted = key;
    this.opts.onStatus(detail === undefined ? { name: SOURCE_NAME, status } : { name: SOURCE_NAME, status, detail });
  }

  get currentStatus(): SourceStatus {
    return this.status;
  }
}

/**
 * Kütüphanenin hataları her zaman Error örneği değildir (ör. InvalidResponseCompositeError),
 * bu yüzden yalnızca yapısal olarak message alanına bakılır.
 */
function describe(err: unknown): string {
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && err !== null) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return 'Kütüphane hatası';
}

/** Yayın kapalıyken kütüphanenin fırlattığı UserOfflineError'ı tanır. */
export function isOfflineError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const name = (err as { name?: unknown }).name;
  const ctor = (err as { constructor?: { name?: unknown } }).constructor?.name;
  return name === 'UserOfflineError' || ctor === 'UserOfflineError';
}
