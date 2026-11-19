import {
  GIFT_TIER_LABELS,
  type ErrorReason,
  type GameEvent,
  type GameWorld,
  type GiftEffect,
  type WinReason,
} from '@ttl/game-core';

export const LOG_LIMIT = 60;

export const GIFT_EFFECT_TEXT: Record<GiftEffect, string> = {
  speed: 'hız bonusu aldı',
  shield: 'kalkan aldı',
  boss: 'canavarı güçlendirdi',
  blackout: 'karartma olayı başlattı',
  surge: 'jeneratörlere sıçrama gönderdi',
};

export const REASON_LABEL: Record<WinReason, string> = {
  'generators-done': 'Tüm jeneratörler çalıştırıldı',
  'all-caught': 'Tüm hayatta kalanlar yakalandı',
  timeout: 'Süre doldu',
};

const ERROR_TEXT: Record<ErrorReason, string> = {
  invalid_request: 'Geçersiz istek',
  invalid_name: 'Geçersiz kullanıcı adı',
  invalid_text: 'Geçersiz metin',
  name_taken: 'Bu kullanıcı adı lobide zaten var',
  room_full: 'Lobi dolu (en fazla 20 oyuncu)',
  match_in_progress: 'Maç devam ediyor, yeni katılım yok',
  match_already_started: 'Maç zaten başladı',
  not_enough_players: 'En az 2 oyuncu gerekli',
  unauthorized: 'Yetkisiz: host token hatalı',
  rate_limited: 'Çok hızlı yorum, biraz bekleyin',
  queue_full: 'Sunucu yoğun, komut atılamadı',
  unknown_command: 'Tanınmayan komut',
  unknown_gift: 'Bu hediye için eşleme yok (panelden ekleyin)',
  not_joined: 'Önce oyuna katılın (GİR)',
};

export function errorText(reason: ErrorReason): string {
  return ERROR_TEXT[reason];
}

export function pushLog(log: string[], line: string): void {
  log.push(line);
  if (log.length > LOG_LIMIT) log.splice(0, log.length - LOG_LIMIT);
}

export function describeEvent(world: GameWorld, e: GameEvent): string {
  const name = (key: string): string => world.players[key]?.name ?? key;
  switch (e.type) {
    case 'joined':
      return `${name(e.key)} lobiye katıldı`;
    case 'task-progress':
      return `${name(e.by)} jeneratör #${e.generatorId + 1} üzerinde çalıştı (%${e.progress})`;
    case 'generator-done':
      return `${name(e.by)} jeneratör #${e.generatorId + 1} tamamladı`;
    case 'caught':
      return `${name(e.by)}, ${name(e.victim)} oyuncusunu yakaladı`;
    case 'rescued':
      return `${name(e.by)}, ${name(e.victim)} oyuncusunu kurtardı`;
    case 'shield-blocked':
      return `${name(e.victim)} kalkanıyla ${name(e.by)} yakalamasını engelledi`;
    case 'gift-effect':
      return `${name(e.by)} ${GIFT_EFFECT_TEXT[e.effect]}${e.target && e.target !== e.by ? ` (${name(e.target)})` : ''}`;
    case 'gift-ignored':
      return `${name(e.by)} hediyesi (${GIFT_TIER_LABELS[e.tier]}) bu oyunda etki yaratmadı`;
    case 'ended':
      return `Oyun bitti: ${e.winner === 'survivors' ? 'Hayatta kalanlar' : 'Katil'} kazandı (${REASON_LABEL[e.reason]})`;
  }
}
