import type { GameEvent, GameWorld, GiftEntry, HostStatus, SourceInfo } from '@ttl/game-core';

/**
 * Oyun ekranı, yayıncı paneli ve ağ istemcisi arasında paylaşılan durum.
 * world: sunucudan gelen dünya kopyası (null = henüz init gelmedi).
 * stale: overlay bağlantısının oda kimliği artık geçerli değil.
 */
export interface Session {
  world: GameWorld | null;
  pending: GameEvent[];
  log: string[];
  connected: boolean;
  source: SourceInfo | null;
  gifts: GiftEntry[];
  stale: boolean;
  hostStatus: HostStatus | null;
  /** null: henüz denenmedi, true: anahtar geçerli, false: anahtar hatalı ya da yok. */
  authOk: boolean | null;
}

export function createSession(): Session {
  return {
    world: null,
    pending: [],
    log: [],
    connected: false,
    source: null,
    gifts: [],
    stale: false,
    hostStatus: null,
    authOk: null,
  };
}
