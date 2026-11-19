import type { Command } from './types';

/**
 * Yorum metinlerini oyun komutlarına çevirir.
 * Türkçe büyük/küçük harf kuralları (i/İ, ı/I) tr-TR locale'i ile uygulanır.
 * ASCII alternatifleri (SAG, ASAGI, GOREV, GIR) de kabul edilir.
 * Noktalama ve fazla boşluk yok sayılır: "sol!!" → SOL.
 */
const ALIASES = new Map<string, Command>([
  ['GİR', { type: 'join' }],
  ['GIR', { type: 'join' }],
  ['SOL', { type: 'move', dir: 'left' }],
  ['SAĞ', { type: 'move', dir: 'right' }],
  ['SAG', { type: 'move', dir: 'right' }],
  ['YUKARI', { type: 'move', dir: 'up' }],
  ['AŞAĞI', { type: 'move', dir: 'down' }],
  ['ASAĞI', { type: 'move', dir: 'down' }],
  ['ASAGI', { type: 'move', dir: 'down' }],
  ['GÖREV', { type: 'task' }],
  ['GOREV', { type: 'task' }],
  ['KURTAR', { type: 'rescue' }],
]);

export function normalizeCommandText(text: string): string {
  return text
    .toLocaleUpperCase('tr-TR')
    .replace(/[^\p{L}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseCommand(text: string): Command | null {
  const found = ALIASES.get(normalizeCommandText(text));
  return found ? { ...found } : null;
}
