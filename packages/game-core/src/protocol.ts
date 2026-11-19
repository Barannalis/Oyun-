/**
 * Sunucu ↔ istemci sözleşmesi. Sunucu ve tüm istemciler bu tipleri kullanır.
 *
 * Sunucudan istemciye:
 *   init    → harita, ilk durum ve kaynak durumu (her bağlantıda ve sıfırlamada)
 *   state   → oyuncular, jeneratörler, faz, efektler (yaklaşık 10 Hz)
 *   events  → oyun olayları (katılım, görev, yakalama, kurtarma, hediye, bitiş)
 *   source  → yorum kaynağı durumu (TikTok bağlantısı)
 *   gifts   → hediye eşlemeleri (yalnızca yayıncı paneline)
 *
 * İstemciden sunucuya (ack ile yanıtlanır):
 *   hello      → kullanıcı adıyla katılım veya token ile yeniden bağlanma
 *   command    → oyuncunun kendi soketinden komut
 *   host:*     → yayıncı paneli (host token gerekir)
 */
import type {
  GameEvent,
  GameWorld,
  Generator,
  GiftTier,
  MapData,
  Phase,
  Player,
  WinReason,
  Winner,
} from './types';

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
  | 'unknown_gift'
  | 'not_joined';

export type SourceStatus = 'disabled' | 'idle' | 'connecting' | 'connected' | 'offline' | 'error';

/** Yorum kaynağının (ör. TikTok adaptörü) durumu. Yayıncı paneline gösterilir. */
export interface SourceInfo {
  name: string;
  status: SourceStatus;
  detail?: string;
}

export interface PublicState {
  seed: number;
  tick: number;
  phase: Phase;
  players: Record<string, Player>;
  generators: Generator[];
  winner: Winner | null;
  winReason: WinReason | null;
  bossTicks: number;
  blackoutTicks: number;
}

export interface InitMessage {
  map: MapData;
  state: PublicState;
  source: SourceInfo;
}

export interface StateMessage {
  serverTime: number;
  state: PublicState;
}

export interface EventsMessage {
  events: GameEvent[];
}

export interface GiftEntry {
  name: string;
  tier: GiftTier;
}

export interface GiftsMessage {
  gifts: GiftEntry[];
}

export const GIFT_TIER_LABELS: Record<GiftTier, string> = {
  small: 'Küçük · hız bonusu',
  medium: 'Orta · kalkan',
  big: 'Büyük · canavarı güçlendir',
  special: 'Özel · harita olayı',
};

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

export interface HostGiftRequest extends HostRequest {
  user: string;
  giftName: string;
}

export interface HostGiftSetRequest extends HostRequest {
  name: string;
  tier: GiftTier;
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
    bossTicks: world.bossTicks,
    blackoutTicks: world.blackoutTicks,
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
    bossTicks: init.state.bossTicks,
    blackoutTicks: init.state.blackoutTicks,
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
  world.bossTicks = state.bossTicks;
  world.blackoutTicks = state.blackoutTicks;
}
