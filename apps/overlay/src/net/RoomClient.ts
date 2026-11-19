import { io, type Socket } from 'socket.io-client';
import {
  applyPublicState,
  worldFromInit,
  type AckResult,
  type EventsMessage,
  type InitMessage,
  type SourceInfo,
  type StateMessage,
} from '@ttl/game-core';
import { errorText, pushLog } from '../format';
import type { Session } from '../session';

/**
 * Sunucu bağlantısı. Gelen init/state/events mesajlarını oturum durumuna yazar.
 * Socket.IO bağlantıyı kendisi yeniden kurar, her bağlantıda sunucu init gönderir.
 */
export class RoomClient {
  private readonly socket: Socket;

  constructor(
    url: string,
    private readonly hostToken: string,
    private readonly session: Session,
  ) {
    this.socket = io(url, { reconnectionDelayMax: 3000 });

    this.socket.on('connect', () => {
      session.connected = true;
      pushLog(session.log, '» Sunucuya bağlandı');
    });
    this.socket.on('disconnect', () => {
      session.connected = false;
      pushLog(session.log, '» Bağlantı koptu, yeniden deneniyor');
    });
    this.socket.on('init', (init: InitMessage) => {
      session.world = worldFromInit(init);
      session.source = init.source;
      session.pending.length = 0;
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

  hostStart(): void {
    this.socket.emit('host:start', { token: this.hostToken }, (r: AckResult) =>
      this.report(r, 'Maç başladı'),
    );
  }

  hostReset(): void {
    this.socket.emit('host:reset', { token: this.hostToken }, (r: AckResult) =>
      this.report(r, 'Yeni lobi oluşturuldu'),
    );
  }

  hostChat(user: string, text: string): void {
    this.socket.emit('host:chat', { token: this.hostToken, user, text }, (r: AckResult) => {
      if (!r.ok) pushLog(this.session.log, `» ${user}: ${errorText(r.reason)}`);
    });
  }

  private report(r: AckResult, okText: string): void {
    pushLog(this.session.log, r.ok ? `» ${okText}` : `» ${errorText(r.reason)}`);
  }
}
