import { randomUUID } from 'node:crypto';
import {
  CHAT_BUCKET_CAPACITY,
  CHAT_REFILL_PER_SEC,
  RECONNECT_GRACE_MS,
  STATE_BROADCAST_MS,
  TICK_MS,
  addPlayer,
  createWorld,
  enqueue,
  parseCommand,
  removePlayer,
  setConnected,
  startMatch,
  step,
  toPublicState,
  userKey,
  type AckResult,
  type EventsMessage,
  type GameEvent,
  type GameWorld,
  type HelloResult,
  type InitMessage,
  type StateMessage,
} from '@ttl/game-core';
import { KeyedRateLimiter } from './rateLimit';

/** Odanın dışarıya yayın yaptığı tek kanal. Gerçek uygulamada Socket.IO sunucusu. */
export interface Outbound {
  emit(event: string, payload: unknown): void;
}

export interface RoomOptions {
  seed: number;
  reconnectGraceMs?: number;
}

/**
 * Tek oyun odası. Oyun durumunun tek sahibidir (server-authoritative).
 * Tüm girişler (soket oyuncuları, yorum adaptörü, yayıncı paneli) buradan geçer.
 */
export class GameRoom {
  private current: GameWorld;
  private readonly tokenToKey = new Map<string, string>();
  private readonly keyToToken = new Map<string, string>();
  private readonly socketToKey = new Map<string, string>();
  private readonly keyToSocket = new Map<string, string>();
  private readonly removalTimers = new Map<string, NodeJS.Timeout>();
  private readonly limiter = new KeyedRateLimiter(CHAT_BUCKET_CAPACITY, CHAT_REFILL_PER_SEC);
  private readonly timers: NodeJS.Timeout[] = [];
  private outbox: GameEvent[] = [];
  private readonly graceMs: number;

  constructor(
    private readonly out: Outbound,
    opts: RoomOptions,
  ) {
    this.current = createWorld(opts.seed);
    this.graceMs = opts.reconnectGraceMs ?? RECONNECT_GRACE_MS;
  }

  get world(): GameWorld {
    return this.current;
  }

  initPayload(): InitMessage {
    return { map: this.current.map, state: toPublicState(this.current) };
  }

  start(): void {
    this.timers.push(setInterval(() => this.tick(), TICK_MS));
    this.timers.push(setInterval(() => this.broadcastState(), STATE_BROADCAST_MS));
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers.length = 0;
    for (const t of this.removalTimers.values()) clearTimeout(t);
    this.removalTimers.clear();
  }

  /** Soket üzerinden kullanıcı adıyla katılım. Token varsa yeniden bağlanır. */
  hello(name: string, token?: string): HelloResult {
    if (token !== undefined) {
      const key = this.tokenToKey.get(token);
      if (key !== undefined) {
        const existing = this.current.players[key];
        if (existing) {
          this.cancelRemoval(key);
          setConnected(this.current, key, true);
          return { ok: true, token, key, name: existing.name };
        }
        this.forget(key);
      }
    }

    const added = addPlayer(this.current, name);
    if (!added.ok) return added;

    const newToken = randomUUID();
    this.tokenToKey.set(newToken, added.key);
    this.keyToToken.set(added.key, newToken);
    this.outbox.push({ type: 'joined', key: added.key });
    return { ok: true, token: newToken, key: added.key, name: this.current.players[added.key].name };
  }

  bindSocket(key: string, socketId: string): void {
    const previous = this.keyToSocket.get(key);
    if (previous !== undefined && previous !== socketId) this.socketToKey.delete(previous);
    this.keyToSocket.set(key, socketId);
    this.socketToKey.set(socketId, key);
  }

  keyOfSocket(socketId: string): string | undefined {
    return this.socketToKey.get(socketId);
  }

  nameOf(key: string): string | undefined {
    return this.current.players[key]?.name;
  }

  /** Soket kopunca çağrılır. Eski bir soket, oyuncu yeniden bağlandıktan sonra kopsa da etkilenmez. */
  onSocketDisconnect(socketId: string): void {
    const key = this.socketToKey.get(socketId);
    if (key === undefined) return;
    this.socketToKey.delete(socketId);
    if (this.keyToSocket.get(key) !== socketId) return;

    this.keyToSocket.delete(key);
    setConnected(this.current, key, false);
    if (this.current.phase !== 'lobby') return;

    this.cancelRemoval(key);
    const timer = setTimeout(() => {
      this.removalTimers.delete(key);
      if (this.current.players[key]?.connected) return;
      if (removePlayer(this.current, key)) {
        this.forget(key);
        this.broadcastState();
      }
    }, this.graceMs);
    this.removalTimers.set(key, timer);
  }

  /**
   * Tüm yorum girişleri. Oyuncu hız sınırı burada uygulanır, böylece
   * soketten, TikTok adaptöründen veya panelden gelen yorumlar aynı kurala tabidir.
   */
  submitChat(user: string, text: string): AckResult {
    const key = userKey(user);
    if (!this.limiter.take(key)) return { ok: false, reason: 'rate_limited' };
    const command = parseCommand(text);
    if (!command) return { ok: false, reason: 'unknown_command' };
    return enqueue(this.current, user, command) ? { ok: true } : { ok: false, reason: 'queue_full' };
  }

  startMatch(): AckResult {
    const result = startMatch(this.current);
    if (!result.ok) return { ok: false, reason: result.reason };
    this.broadcastState();
    return { ok: true };
  }

  /** Yeni lobi. Tüm oyuncu kimlikleri silinir, istemciler yeniden katılmalıdır. */
  reset(seed: number): void {
    for (const key of [...this.removalTimers.keys()]) this.cancelRemoval(key);
    this.tokenToKey.clear();
    this.keyToToken.clear();
    this.socketToKey.clear();
    this.keyToSocket.clear();
    this.limiter.clear();
    this.outbox = [];
    this.current = createWorld(seed);
    this.out.emit('init', this.initPayload());
  }

  private tick(): void {
    step(this.current);
    for (const e of this.current.events) this.outbox.push(e);
    this.flushEvents();
  }

  private flushEvents(): void {
    if (this.outbox.length === 0) return;
    const payload: EventsMessage = { events: this.outbox };
    this.outbox = [];
    this.out.emit('events', payload);
  }

  private broadcastState(): void {
    const payload: StateMessage = { serverTime: Date.now(), state: toPublicState(this.current) };
    this.out.emit('state', payload);
  }

  private cancelRemoval(key: string): void {
    const t = this.removalTimers.get(key);
    if (t !== undefined) clearTimeout(t);
    this.removalTimers.delete(key);
  }

  private forget(key: string): void {
    this.cancelRemoval(key);
    const token = this.keyToToken.get(key);
    if (token !== undefined) this.tokenToKey.delete(token);
    this.keyToToken.delete(key);
    const socketId = this.keyToSocket.get(key);
    if (socketId !== undefined) this.socketToKey.delete(socketId);
    this.keyToSocket.delete(key);
    this.limiter.forget(key);
  }
}
