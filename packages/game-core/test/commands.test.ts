import { describe, expect, it } from 'vitest';
import { normalizeCommandText, parseCommand } from '../src/commands';

describe('parseCommand', () => {
  it('Türkçe komutları çözer', () => {
    expect(parseCommand('GİR')).toEqual({ type: 'join' });
    expect(parseCommand('SOL')).toEqual({ type: 'move', dir: 'left' });
    expect(parseCommand('SAĞ')).toEqual({ type: 'move', dir: 'right' });
    expect(parseCommand('YUKARI')).toEqual({ type: 'move', dir: 'up' });
    expect(parseCommand('AŞAĞI')).toEqual({ type: 'move', dir: 'down' });
    expect(parseCommand('GÖREV')).toEqual({ type: 'task' });
    expect(parseCommand('KURTAR')).toEqual({ type: 'rescue' });
  });

  it('küçük harf ve Türkçe i/ı kurallarını doğru uygular', () => {
    expect(parseCommand('gir')).toEqual({ type: 'join' });
    expect(parseCommand('sağ')).toEqual({ type: 'move', dir: 'right' });
    expect(parseCommand('aşağı')).toEqual({ type: 'move', dir: 'down' });
    expect(parseCommand('görev')).toEqual({ type: 'task' });
    expect(parseCommand('kurtar')).toEqual({ type: 'rescue' });
  });

  it('ASCII alternatiflerini kabul eder', () => {
    expect(parseCommand('SAG')).toEqual({ type: 'move', dir: 'right' });
    expect(parseCommand('ASAGI')).toEqual({ type: 'move', dir: 'down' });
    expect(parseCommand('GOREV')).toEqual({ type: 'task' });
    expect(parseCommand('GIR')).toEqual({ type: 'join' });
  });

  it('noktalama ve fazla boşluğu yok sayar', () => {
    expect(parseCommand('  sol!!  ')).toEqual({ type: 'move', dir: 'left' });
    expect(parseCommand('GİR.')).toEqual({ type: 'join' });
    expect(parseCommand('SOL   SOL')).toBeNull();
  });

  it('bilinmeyen yorumları null döndürür', () => {
    expect(parseCommand('merhaba')).toBeNull();
    expect(parseCommand('')).toBeNull();
    expect(parseCommand('😀')).toBeNull();
    expect(parseCommand('constructor')).toBeNull();
  });

  it('dönen komut nesnesini değiştirmek ana tabloyu bozmaz', () => {
    const a = parseCommand('SOL');
    if (a && a.type === 'move') a.dir = 'up';
    expect(parseCommand('SOL')).toEqual({ type: 'move', dir: 'left' });
  });

  it('normalizeCommandText tr-TR büyük harf dönüşümü yapar', () => {
    expect(normalizeCommandText('i')).toBe('İ');
    expect(normalizeCommandText('ı')).toBe('I');
  });
});
