/**
 * Tüm oyun ayarları tek yerde. Denge değişiklikleri buradan yapılır.
 * Süreler tick cinsindendir (TICK_RATE tick = 1 saniye).
 */

export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE;

/** Sunucunun durum yayın sıklığı (ms). Tick'ten seyrek tutulur. */
export const STATE_BROADCAST_MS = 100;

export const MAP_WIDTH = 31;
export const MAP_HEIGHT = 19;

export const MAX_PLAYERS = 20;
export const MIN_PLAYERS_TO_START = 2;
export const MAX_NAME_LENGTH = 32;
export const MAX_CHAT_LENGTH = 120;
export const MAX_QUEUE_LENGTH = 2000;

/** Bağlantısı kopan lobi oyuncusunun yeniden bağlanmak için beklediği süre (ms). */
export const RECONNECT_GRACE_MS = 30_000;

/** Kullanıcı başına yorum sınırı: en fazla CAPACITY ardışık yorum, saniyede REFILL yenileme. */
export const CHAT_BUCKET_CAPACITY = 6;
export const CHAT_REFILL_PER_SEC = 4;

export const GENERATOR_COUNT = 4;
export const GENERATOR_REQUIRED_PROGRESS = 100;
export const GENERATOR_PROGRESS_PER_TASK = 10;

// Hareket ve eylem bekleme süreleri (tick)
export const MOVE_COOLDOWN_SURVIVOR = 6;
export const MOVE_COOLDOWN_KILLER_DAY = 5;
export const MOVE_COOLDOWN_KILLER_NIGHT = 4;
export const TASK_COOLDOWN = 20;
export const CATCH_COOLDOWN = 20;
export const RESCUE_COOLDOWN = 20;

// Kurtarma: yakalanan oyuncu kaç KURTAR komutuyla serbest kalır
export const RESCUE_REQUIRED = 5;
// Kurtarılan oyuncunun tekrar yakalanmama süresi
export const RESCUE_IMMUNITY_TICKS = 60;

// Gece/gündüz döngüsü: 90 sn gündüz, 60 sn gece
export const DAY_TICKS = 90 * TICK_RATE;
export const NIGHT_TICKS = 60 * TICK_RATE;
export const CYCLE_TICKS = DAY_TICKS + NIGHT_TICKS;

// Maç süresi: 5 dakika. Süre dolarsa katil kazanır.
export const MATCH_TICKS = 5 * 60 * TICK_RATE;

// Görüş yarıçapı (kare cinsinden)
export const VISION = {
  survivorDay: 12,
  survivorNight: 4,
  killerDay: 12,
  killerNight: 6,
} as const;

export const SCORE = {
  task: 1,
  catch: 5,
  rescue: 3,
} as const;

// ---- Hediye sistemi (Aşama 5) ---------------------------------------------
export const GIFT = {
  /** Küçük: hız bonusu süresi ve hareket beklemesi çarpanı */
  speedTicks: 8 * TICK_RATE,
  speedCooldownFactor: 0.5,
  /** Orta: kalkan süresi (bir yakalamayı engeller) */
  shieldTicks: 20 * TICK_RATE,
  /** Büyük: canavarı güçlendirme süresi */
  bossTicks: 15 * TICK_RATE,
  bossCatchCooldown: 5,
  bossMoveCooldownMin: 2,
  /** Özel: karartma süresi ve jeneratör sıçraması miktarı */
  blackoutTicks: 10 * TICK_RATE,
  surgeProgress: 20,
} as const;
