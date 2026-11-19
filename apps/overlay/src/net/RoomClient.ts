import { io, type Socket } from 'socket.io-client';
import {
  applyPublicState,
  worldFromInit,
  type AckResult,
  type Difficulty,
  type EventsMessage,
  type GiftEntry,
  type GiftTier,
  type HostStatus,
  type InitMessage,
  type SourceInfo,
  type StateMessage,
} from '@ttl/game-core';
import { errorText, pushLog } from '../format';
import type { Session } from '../session';

export interface RoomClientOptions {
  url: string;
  /** Overlay için: bağlantının beklediği oda kimliği. Panel için boş. */
  roomId?: string | null;
  /** Yayıncı paneli için: oturumda saklanan host anahtarı. Overlay'de yoktur. */
  getToken?: () => string | undefined;
}

type HostAck = { ok: boolean; reason?: string } & Partial<HostStatus>;

/**
 * Sunucu bağlantısı. Overlay ve panel aynı sınıfı kullanır. Yalnızca panel,
 * host token ile yönetim olaylarını gönderebilir.
 */
export class RoomClient {
  private readonly socket: Socket;

  constructor(
    private readonly session: Session,
    private readonly opts: RoomClientOptions,
  ) {
    this.socket = io(opts.url, {
      reconnectionDelayMax: 3000,
      auth: opts.roomId ? { room: opts.roomId } : {},
    });

    this.socket.on('connect', () => {
      session.connected = true;
      pushLog(session.log, '» Sunucuya bağlandı');
      this.refreshGifts();
      this.refreshStatus();
    });
    this.socket.on('disconnect', () => {
      session.connected = false;
      pushLog(session.log, '» Bağlantı koptu, yeniden deneniyor');
    });
    this.socket.on('connect_error', (err: Error) => {
      session.connected = false;
      if (err.message === 'room_mismatch') {
        session.stale = true;
        pushLog(session.log, '» Bu yayın bağlantısı eski. Yayıncı panelinden yeni bağlantıyı alın.');
        this.socket.disconnect();
      }
    });
    this.socket.on('init', (init: InitMessage) => {
      session.world = worldFromInit(init);
      session.source = init.source;
      session.pending.length = 0;
      session.stale = opts.roomId ? init.roomId !== opts.roomId : false;
    });
    this.socket.on('state', (msg: StateMessage) => {
      if (session.world) applyPublicState(session.world, msg.state);
    });
    this.socket.on('source', (info: SourceInfo) => {
      session.source = info;
    });
    this.socket.on('events', (msg: EventsMessage) => {
      for (const e of msg.events) session.pending.push(e);
    });
  }

  /** Yayıncı paneli için: host olaylarını token ile gönderir. Token yoksa yerelde reddedilir. */
  private host(event: string, extra: Record<string, unknown>, done: (r: AckResult | HostAck) => void): void {
    const token = this.opts.getToken?.();
    if (!token) {
      done({ ok: false, reason: 'unauthorized' });
      return;
    }
    this.socket.emit(event, { token, ...extra }, done);
  }

  private reportResult(r: AckResult | HostAck, okText: string): void {
    if (r.ok) pushLog(this.session.log, `» ${okText}`);
    else pushLog(this.session.log, `» ${errorText(r.reason as Parameters<typeof errorText>[0])}`);
  }

  refreshStatus(): void {
    // Anahtar hiç girilmediyse 'hatalı' değil, 'bilinmiyor' durumudur.
    if (!this.opts.getToken?.()) {
      this.session.authOk = null;
      return;
    }
    this.host('host:status', {}, (r) => {
      const ack = r as HostAck;
      if (ack.ok && ack.roomId) {
        this.session.authOk = true;
        this.session.hostStatus = {
          roomId: ack.roomId,
          phase: ack.phase ?? 'lobby',
          difficulty: ack.difficulty ?? 'normal',
          blocked: ack.blocked ?? [],
        };
      } else if (ack.reason === 'unauthorized') {
        this.session.authOk = false;
      }
    });
  }

  refreshGifts(): void {
    this.host('host:gifts', {}, (r) => {
      const ack = r as { ok: boolean; gifts?: GiftEntry[] };
      if (ack.ok && ack.gifts) this.session.gifts = ack.gifts;
    });
  }

  hostStart(): void {
    this.host('host:start', {}, (r) => this.reportResult(r as AckResult, 'Maç başladı'));
  }

  hostStop(): void {
    this.host('host:stop', {}, (r) => {
      this.reportResult(r as AckResult, 'Maç durduruldu');
      this.refreshStatus();
    });
  }

  hostReset(): void {
    this.host('host:reset', {}, (r) => {
      this.reportResult(r as AckResult, 'Yeni oda oluşturuldu. Eski yayın bağlantıları geçersiz.');
      this.refreshStatus();
    });
  }

  hostDifficulty(difficulty: Difficulty): void {
    this.host('host:difficulty', { difficulty }, (r) => {
      this.reportResult(r as AckResult, `Zorluk: ${difficulty}`);
      this.refreshStatus();
    });
  }

  hostBlock(name: string): void {
    this.host('host:block', { name }, (r) => {
      this.reportResult(r as AckResult, `Engellendi: ${name}`);
      this.refreshStatus();
    });
  }

  hostUnblock(name: string): void {
    this.host('host:unblock', { name }, (r) => {
      this.reportResult(r as AckResult, `Engel kaldırıldı: ${name}`);
      this.refreshStatus();
    });
  }

  hostChat(user: string, text: string): void {
    this.host('host:chat', { user, text }, (r) => {
      const ack = r as AckResult;
      if (!ack.ok) pushLog(this.session.log, `» ${user}: ${errorText(ack.reason)}`);
    });
  }

  sendGift(user: string, giftName: string): void {
    this.host('host:gift', { user, giftName }, (r) => {
      const ack = r as AckResult;
      if (!ack.ok) pushLog(this.session.log, `» ${user} hediyesi: ${errorText(ack.reason)}`);
    });
  }

  setGift(name: string, tier: GiftTier): void {
    this.host('host:gift:set', { name, tier }, (r) => {
      this.reportResult(r as AckResult, `Eşleme kaydedildi: ${name}`);
      this.refreshGifts();
    });
  }

  deleteGift(name: string): void {
    this.host('host:gift:delete', { name }, (r) => {
      this.reportResult(r as AckResult, `Eşleme silindi: ${name}`);
      this.refreshGifts();
    });
  }
}
