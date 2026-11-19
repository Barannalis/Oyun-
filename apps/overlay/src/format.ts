import { type GameEvent, type GameWorld, type WinReason } from '@ttl/game-core';

export const LOG_LIMIT = 60;

export const REASON_LABEL: Record<WinReason, string> = {
  'generators-done': 'Tüm jeneratörler çalıştırıldı',
  'all-caught': 'Tüm hayatta kalanlar yakalandı',
  timeout: 'Süre doldu',
};

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
    case 'ended':
      return `Oyun bitti: ${e.winner === 'survivors' ? 'Hayatta kalanlar' : 'Katil'} kazandı (${REASON_LABEL[e.reason]})`;
  }
}
