export type Direction = 'up' | 'down' | 'left' | 'right';
export type Role = 'survivor' | 'killer';
export type Phase = 'lobby' | 'playing' | 'ended';
export type Winner = 'survivors' | 'killer';
export type WinReason = 'generators-done' | 'all-caught' | 'timeout';
export type GiftTier = 'small' | 'medium' | 'big' | 'special';
export type GiftEffect = 'speed' | 'shield' | 'boss' | 'blackout' | 'surge';

/** Yorumdan çözümlenmiş oyun komutu. Metin burada yoktur. */
export type Command =
  | { type: 'join' }
  | { type: 'move'; dir: Direction }
  | { type: 'task' }
  | { type: 'rescue' }
  | { type: 'gift'; tier: GiftTier; giftName: string };

/** Sıraya alınmış, henüz uygulanmamış bir oyuncu komutu. */
export interface Intent {
  userKey: string;
  name: string;
  command: Command;
}

export interface Player {
  /** Benzersiz kimlik: küçük harfe çevrilmiş kullanıcı adı. Çift katılımı engeller. */
  key: string;
  name: string;
  role: Role;
  /** Harita koordinatları. Lobide -1, -1. */
  x: number;
  y: number;
  caught: boolean;
  rescueProgress: number;
  /** Kurtarıldıktan sonra kalan koruma süresi (tick). */
  immunity: number;
  /** Bir sonraki eyleme kadar kalan süre (tick). */
  cooldown: number;
  score: number;
  /** Oyuncunun bağlantısı açık mı. Yalnızca soket üzerinden katılanlar için anlamlıdır. */
  connected: boolean;
  /** Hız bonusu kalan süre (tick). */
  speedTicks: number;
  /** Kalkan kalan süre (tick). Bir yakalamayı engeller ve tüketilir. */
  shieldTicks: number;
}

export interface Generator {
  id: number;
  x: number;
  y: number;
  progress: number;
  done: boolean;
}

/** Satır sırası ile tiles[y * width + x]. Değerler map.ts'deki TILE_* sabitleridir. */
export interface MapData {
  width: number;
  height: number;
  tiles: number[];
}

export type GameEvent =
  | { type: 'joined'; key: string }
  | { type: 'task-progress'; generatorId: number; by: string; progress: number }
  | { type: 'generator-done'; generatorId: number; by: string }
  | { type: 'caught'; victim: string; by: string }
  | { type: 'rescued'; victim: string; by: string }
  | { type: 'shield-blocked'; victim: string; by: string }
  | { type: 'gift-effect'; tier: GiftTier; effect: GiftEffect; by: string; target: string | null }
  | { type: 'gift-ignored'; tier: GiftTier; by: string }
  | { type: 'ended'; winner: Winner; reason: WinReason };

export interface GameWorld {
  seed: number;
  /** RNG durumu. Aynı tohum ve aynı komut sırası her zaman aynı sonucu verir. */
  rngState: number;
  tick: number;
  phase: Phase;
  map: MapData;
  players: Record<string, Player>;
  generators: Generator[];
  queue: Intent[];
  /** Son step() çağrısında üretilen olaylar. Her step'te sıfırlanır. */
  events: GameEvent[];
  winner: Winner | null;
  winReason: WinReason | null;
  /** Büyük hediyeyle güçlenmiş katilin kalan süresi (tick). */
  bossTicks: number;
  /** Karartma olayının kalan süresi (tick). */
  blackoutTicks: number;
}

export interface Position {
  x: number;
  y: number;
}

export type StartFailure = 'match_already_started' | 'not_enough_players';
export type StartResult = { ok: true } | { ok: false; reason: StartFailure };
