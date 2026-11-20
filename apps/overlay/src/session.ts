import type { GameEvent, GameWorld, GiftEntry, HostStatus, SourceInfo } from '@ttl/game-core';

/**
 * Oyun ekranı, yayıncı paneli ve ağ istemcisi arasında paylaşılan durum.
 * world: sunucudan gelen dünya kopyası (null = henüz init gelmedi).
 * stale: overlay bağlantısının oda kimliği artık geçerli değil.
 */
/** Tamamlanmış bir maçın özeti. Denge ölçümü için panelden indirilir. */
export interface MatchRecord {
  startedAt: string;
  endedAt: string;
  durationSec: number;
  players: number;
  killer: string | null;
  winner: 'survivors' | 'killer' | null;
  reason: string;
  catches: number;
  rescues: number;
  generatorsDone: number;
  shieldBlocks: number;
}

/** Devam eden maçın sayaçları. Maç bitince MatchRecord'a dönüşür. */
export interface MatchDraft {
  startedMs: number;
  startedAt: string;
  players: number;
  killer: string | null;
  catches: number;
  rescues: number;
  generatorsDone: number;
  shieldBlocks: number;
}

export interface Session {
  matches: MatchRecord[];
  matchDraft: MatchDraft | null;
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
    matches: [],
    matchDraft: null,
  };
}
