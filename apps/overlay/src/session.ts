import type { GameEvent, GameWorld } from '@ttl/game-core';

/**
 * Oyun ekranı ile ağ istemcisi arasında paylaşılan durum.
 * world: sunucudan gelen dünya kopyası (null = henüz init gelmedi).
 */
export interface Session {
  world: GameWorld | null;
  pending: GameEvent[];
  log: string[];
  connected: boolean;
}

export function createSession(): Session {
  return { world: null, pending: [], log: [], connected: false };
}
