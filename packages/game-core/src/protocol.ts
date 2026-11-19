/**
 * Sunucu ↔ istemci sözleşmesi. Sunucu ve tüm istemciler bu tipleri kullanır.
 *
 * Sunucudan istemciye:
 *   init    → harita + ilk durum (her bağlantıda ve sıfırlamada)
 *   state   → oyuncular, jeneratörler, faz (yaklaşık 10 Hz)
 *   events  → oyun olayları (katılım, görev, yakalama, kurtarma, bitiş)
 *
 * İstemciden sunucuya (ack ile yanıtlanır):
 *   hello      → kullanıcı adıyla katılım veya token ile yeniden bağlanma
 *   command    → oyuncunun kendi soketinden komut
 *   host:start, host:reset, host:chat → yayıncı paneli (host token gerekir)
 */
import type { GameEvent, GameWorld, Generator, MapData, Phase, Player, WinReason, Winner } from './types';

export type ErrorReason =
  | 'invalid_request'
  | 'invalid_name'
  | 'invalid_text'
  | 'name_taken'
  | 'room_full'
  | 'match_in_progress'
  | 'match_already_started'
  | 'not_enough_players'
  | 'unauthorized'
  | 'rate_limited'
  | 'queue_full'
  | 'unknown_command'
  | 'not_joined';

export interface PublicState {
  seed: number;
  tick: number;
  phase: Phase;
  players: Record<string, Player>;
  generators: Generator[];
  winner: Winner | null;
  winReason: WinReason | null;
}

export interface InitMessage {
  map: MapData;
  state: PublicState;
}

export interface StateMessage {
  serverTime: number;
  state: PublicState;
}

export interface EventsMessage {
  events: GameEvent[];
}

export interface HelloRequest {
  name: string;
  token?: string;
}

export type HelloResult =
  | { ok: true; token: string; key: string; name: string }
  | { ok: false; reason: ErrorReason };

export type AckResult = { ok: true } | { ok: false; reason: ErrorReason };

export interface HostRequest {
  token: string;
}

export interface HostChatRequest extends HostRequest {
  user: string;
  text: string;
}

export interface CommandRequest {
  text: string;
}

export function toPublicState(world: GameWorld): PublicState {
  return {
    seed: world.seed,
    tick: world.tick,
    phase: world.phase,
    players: Object.fromEntries(Object.entries(world.players).map(([k, p]) => [k, { ...p }])),
    generators: world.generators.map((g) => ({ ...g })),
    winner: world.winner,
    winReason: world.winReason,
  };
}

/** İstemci tarafında boş bir dünya kurar. Oyun mantığı burada çalıştırılmaz. */
export function worldFromInit(init: InitMessage): GameWorld {
  return {
    seed: init.state.seed,
    rngState: 0,
    tick: init.state.tick,
    phase: init.state.phase,
    map: init.map,
    players: init.state.players,
    generators: init.state.generators,
    queue: [],
    events: [],
    winner: init.state.winner,
    winReason: init.state.winReason,
  };
}

/** Mevcut dünya nesnesinin kimliğini koruyarak durumunu günceller. */
export function applyPublicState(world: GameWorld, state: PublicState): void {
  world.tick = state.tick;
  world.phase = state.phase;
  world.players = state.players;
  world.generators = state.generators;
  world.winner = state.winner;
  world.winReason = state.winReason;
}
