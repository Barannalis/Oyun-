import { describe, expect, it } from 'vitest';
import {
  CYCLE_TICKS,
  DAY_TICKS,
  GENERATOR_PROGRESS_PER_TASK,
  MATCH_TICKS,
  MAX_PLAYERS,
  RESCUE_IMMUNITY_TICKS,
  RESCUE_REQUIRED,
  TICK_RATE,
} from '../src/config';
import { isWalkable, manhattan } from '../src/map';
import { parseCommand } from '../src/commands';
import { createWorld, enqueue, isNight, litTiles, startMatch, step, userKey } from '../src/world';
import type { Command, Direction, GameWorld, Player } from '../src/types';

const DIRS: Direction[] = ['up', 'down', 'left', 'right'];

function cmd(text: string): Command {
  const c = parseCommand(text);
  if (!c) throw new Error(`Komut çözülemedi: ${text}`);
  return c;
}

function say(w: GameWorld, name: string, text: string): void {
  enqueue(w, name, cmd(text));
}

function lobby(seed: number, names: string[]): GameWorld {
  const w = createWorld(seed);
  for (const n of names) say(w, n, 'GİR');
  step(w);
  return w;
}

function started(seed: number, names = ['Ali', 'Ayşe', 'Mehmet', 'Zeynep']): GameWorld {
  const w = lobby(seed, names);
  const r = startMatch(w);
  if (!r.ok) throw new Error(r.reason);
  return w;
}

function byRole(w: GameWorld, role: Player['role']): Player[] {
  return Object.values(w.players).filter((p) => p.role === role);
}

/** Bir hayatta kalanın yanına komşu bir yürünebilir kare bulur ve oraya taşır. */
function placeNextTo(w: GameWorld, p: Player, target: { x: number; y: number }): void {
  const spot = [
    { x: target.x + 1, y: target.y },
    { x: target.x - 1, y: target.y },
    { x: target.x, y: target.y + 1 },
    { x: target.x, y: target.y - 1 },
  ].find((s) => isWalkable(w.map, s.x, s.y));
  if (!spot) throw new Error('komşu kare yok');
  p.x = spot.x;
  p.y = spot.y;
}

function idle(w: GameWorld, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(w);
}

describe('lobi ve katılım', () => {
  it('GİR ile oyuncu lobiye katılır', () => {
    const w = lobby(1, ['Ali']);
    expect(Object.keys(w.players)).toEqual(['ali']);
    expect(w.players.ali.name).toBe('Ali');
  });

  it('aynı kullanıcı adıyla çift katılımı engeller (büyük/küçük harf ve @ farkı dahil)', () => {
    const w = lobby(2, ['Ali', 'ali', '@ALİ', 'Ali']);
    expect(Object.keys(w.players)).toHaveLength(1);
  });

  it('en fazla MAX_PLAYERS oyuncu kabul eder', () => {
    const names = Array.from({ length: MAX_PLAYERS + 5 }, (_, i) => `oyuncu${i}`);
    const w = lobby(3, names);
    expect(Object.keys(w.players)).toHaveLength(MAX_PLAYERS);
  });

  it('oyun başladıktan sonra yeni katılım kabul edilmez', () => {
    const w = started(4);
    say(w, 'Yeni', 'GİR');
    step(w);
    expect(w.players.yeni).toBeUndefined();
  });

  it('userKey tutarlı anahtar üretir', () => {
    expect(userKey('  @Ayşe ')).toBe(userKey('ayşe'));
    expect(userKey('İLKER')).toBe('ilker');
  });

  it('boş isimli komut sıraya alınmaz', () => {
    const w = createWorld(5);
    expect(enqueue(w, '   ', { type: 'join' })).toBe(false);
    expect(w.queue).toHaveLength(0);
  });
});

describe('maç başlatma', () => {
  it('en az iki oyuncu olmadan başlamaz', () => {
    const w = lobby(10, ['Tek']);
    const r = startMatch(w);
    expect(r.ok).toBe(false);
    expect(w.phase).toBe('lobby');
  });

  it('tam olarak bir katil ve diğerleri hayatta kalan olur, herkes haritada', () => {
    const w = started(11, ['A', 'B', 'C', 'D', 'E']);
    expect(w.phase).toBe('playing');
    expect(byRole(w, 'killer')).toHaveLength(1);
    expect(byRole(w, 'survivor')).toHaveLength(4);
    for (const p of Object.values(w.players)) {
      expect(isWalkable(w.map, p.x, p.y)).toBe(true);
    }
  });

  it('aynı tohum ve aynı katılım sırası aynı katili seçer', () => {
    const a = started(12, ['A', 'B', 'C']);
    const b = started(12, ['A', 'B', 'C']);
    expect(byRole(a, 'killer')[0].key).toBe(byRole(b, 'killer')[0].key);
  });

  it('ikinci kez başlatma reddedilir', () => {
    const w = started(13);
    expect(startMatch(w).ok).toBe(false);
  });
});

describe('hareket', () => {
  it('duvara doğru hareket etmez', () => {
    const w = started(20);
    const s = byRole(w, 'survivor')[0];
    // Oyuncuyu bilinen bir köşeye, hemen yanına duvar koyarak yerleştir.
    s.x = 1;
    s.y = 1;
    w.map.tiles[1 * w.map.width + 0] = 1;
    const before = { x: s.x, y: s.y };
    say(w, s.name, 'SOL');
    step(w);
    expect({ x: s.x, y: s.y }).toEqual(before);
  });

  it('bekleme süresi (cooldown) dolmadan ikinci hareket yapılmaz', () => {
    const w = started(21);
    const s = byRole(w, 'survivor')[0];
    s.x = 9;
    s.y = 9;
    w.map.tiles.fill(0);
    s.cooldown = 0;

    say(w, s.name, 'SAĞ');
    step(w);
    expect(s.x).toBe(10);

    say(w, s.name, 'SAĞ');
    step(w);
    expect(s.x).toBe(10);

    idle(w, 10);
    say(w, s.name, 'SAĞ');
    step(w);
    expect(s.x).toBe(11);
  });

  it('yakalanmış oyuncu hareket edemez', () => {
    const w = started(22);
    const s = byRole(w, 'survivor')[0];
    s.caught = true;
    s.x = 5;
    s.y = 5;
    w.map.tiles.fill(0);
    say(w, s.name, 'YUKARI');
    step(w);
    expect({ x: s.x, y: s.y }).toEqual({ x: 5, y: 5 });
  });
});

describe('jeneratör ve görev', () => {
  it('komşu jeneratörde GÖREV ilerleme sağlar ve puan verir', () => {
    const w = started(30);
    const s = byRole(w, 'survivor')[0];
    const gen = w.generators[0];
    placeNextTo(w, s, gen);
    s.cooldown = 0;

    say(w, s.name, 'GÖREV');
    step(w);
    expect(gen.progress).toBe(GENERATOR_PROGRESS_PER_TASK);
    expect(s.score).toBe(1);
  });

  it('uzaktaki jeneratörde GÖREV hiçbir şey yapmaz', () => {
    const w = started(31);
    const s = byRole(w, 'survivor')[0];
    s.x = 1;
    s.y = 1;
    s.cooldown = 0;
    say(w, s.name, 'GÖREV');
    step(w);
    expect(w.generators.every((g) => g.progress === 0)).toBe(true);
  });

  it('tüm jeneratörler tamamlanınca hayatta kalanlar kazanır', () => {
    const w = started(32);
    for (const g of w.generators) {
      g.progress = 100;
      g.done = true;
    }
    step(w);
    expect(w.phase).toBe('ended');
    expect(w.winner).toBe('survivors');
    expect(w.winReason).toBe('generators-done');
    expect(w.events).toContainEqual({ type: 'ended', winner: 'survivors', reason: 'generators-done' });
  });
});

describe('katil ve yakalama', () => {
  it('katil komşu hayatta kalanı yakalar ve puan kazanır', () => {
    const w = started(40);
    const killer = byRole(w, 'killer')[0];
    const victim = byRole(w, 'survivor')[0];
    placeNextTo(w, killer, victim);
    killer.cooldown = 0;
    victim.immunity = 0;

    say(w, killer.name, 'GÖREV');
    step(w);
    expect(victim.caught).toBe(true);
    expect(killer.score).toBe(5);
    expect(w.events.some((e) => e.type === 'caught')).toBe(true);
  });

  it('korumalı (immunity) oyuncu yakalanmaz', () => {
    const w = started(41);
    const killer = byRole(w, 'killer')[0];
    const victim = byRole(w, 'survivor')[0];
    placeNextTo(w, killer, victim);
    killer.cooldown = 0;
    victim.immunity = 40;
    say(w, killer.name, 'GÖREV');
    step(w);
    expect(victim.caught).toBe(false);
  });

  it('katil uzaktaki oyuncuyu yakalayamaz', () => {
    const w = started(42);
    const killer = byRole(w, 'killer')[0];
    const victim = byRole(w, 'survivor')[0];
    killer.x = 1;
    killer.y = 1;
    victim.x = 20;
    victim.y = 15;
    killer.cooldown = 0;
    say(w, killer.name, 'GÖREV');
    step(w);
    expect(victim.caught).toBe(false);
  });

  it('tüm hayatta kalanlar yakalanınca katil kazanır', () => {
    const w = started(43);
    for (const p of byRole(w, 'survivor')) p.caught = true;
    step(w);
    expect(w.phase).toBe('ended');
    expect(w.winner).toBe('killer');
    expect(w.winReason).toBe('all-caught');
  });

  it('yakalanmış oyuncu komut veremez', () => {
    const w = started(44);
    const s = byRole(w, 'survivor')[0];
    s.caught = true;
    const gen = w.generators[0];
    placeNextTo(w, s, gen);
    s.cooldown = 0;
    say(w, s.name, 'GÖREV');
    step(w);
    expect(gen.progress).toBe(0);
  });

  it('katil KURTAR komutunu kullanamaz', () => {
    const w = started(45);
    const killer = byRole(w, 'killer')[0];
    const victim = byRole(w, 'survivor')[0];
    victim.caught = true;
    placeNextTo(w, killer, victim);
    killer.cooldown = 0;
    say(w, killer.name, 'KURTAR');
    step(w);
    expect(victim.rescueProgress).toBe(0);
    expect(victim.caught).toBe(true);
  });
});

describe('kurtarma', () => {
  it(`${RESCUE_REQUIRED} KURTAR ile serbest kalır ve koruma kazanır`, () => {
    const w = started(50);
    const [victim, rescuer] = byRole(w, 'survivor');
    victim.caught = true;
    placeNextTo(w, rescuer, victim);

    for (let i = 0; i < RESCUE_REQUIRED; i++) {
      rescuer.cooldown = 0;
      say(w, rescuer.name, 'KURTAR');
      step(w);
    }
    expect(victim.caught).toBe(false);
    expect(victim.immunity).toBe(RESCUE_IMMUNITY_TICKS);
    expect(w.events.some((e) => e.type === 'rescued')).toBe(true);
    expect(rescuer.score).toBe(3);

    // Koruma bitene kadar tekrar yakalanamaz
    const killer = byRole(w, 'killer')[0];
    placeNextTo(w, killer, victim);
    killer.cooldown = 0;
    say(w, killer.name, 'GÖREV');
    step(w);
    expect(victim.caught).toBe(false);
  });

  it('koruma süresi dolunca tekrar yakalanabilir', () => {
    const w = started(51);
    const victim = byRole(w, 'survivor')[0];
    const killer = byRole(w, 'killer')[0];
    victim.immunity = 2;
    placeNextTo(w, killer, victim);
    killer.cooldown = 0;
    idle(w, 3);
    killer.cooldown = 0;
    say(w, killer.name, 'GÖREV');
    step(w);
    expect(victim.caught).toBe(true);
  });
});

describe('zaman ve süre', () => {
  it('gece/gündüz döngüsü doğru', () => {
    expect(isNight(0)).toBe(false);
    expect(isNight(DAY_TICKS - 1)).toBe(false);
    expect(isNight(DAY_TICKS)).toBe(true);
    expect(isNight(CYCLE_TICKS - 1)).toBe(true);
    expect(isNight(CYCLE_TICKS)).toBe(false);
  });

  it('süre dolunca katil kazanır (timeout)', () => {
    const w = started(60);
    w.tick = MATCH_TICKS - 1;
    step(w);
    expect(w.phase).toBe('ended');
    expect(w.winner).toBe('killer');
    expect(w.winReason).toBe('timeout');
  });

  it('gece görüş alanı gündüzden küçüktür', () => {
    const w = started(61);
    const litDay = litTiles(w).filter(Boolean).length;
    w.tick = DAY_TICKS + 1;
    const litNight = litTiles(w).filter(Boolean).length;
    expect(litNight).toBeLessThan(litDay);
  });
});

describe('ended durumu ve olaylar', () => {
  it('bitmiş maçta komutlar işlenmez', () => {
    const w = started(70);
    w.phase = 'ended';
    const s = byRole(w, 'survivor')[0];
    s.x = 5;
    s.y = 5;
    w.map.tiles.fill(0);
    say(w, s.name, 'SOL');
    step(w);
    expect(s.x).toBe(5);
    expect(w.queue).toHaveLength(0);
  });

  it('olaylar her step başında temizlenir', () => {
    const w = lobby(71, ['A']);
    expect(w.events).toEqual([{ type: 'joined', key: 'a' }]);
    step(w);
    expect(w.events).toEqual([]);
  });

  it('manhattan mesafesi doğru', () => {
    expect(manhattan({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(7);
  });
});

describe('determinizm', () => {
  it('aynı tohum ve aynı komut akışı aynı dünya durumunu üretir', () => {
    function run(seed: number): string {
      const w = createWorld(seed);
      const names = ['Ali', 'Ayşe', 'Mehmet', 'Zeynep', 'Can'];
      for (const n of names) say(w, n, 'GİR');
      step(w);
      startMatch(w);
      const cmds = ['SOL', 'SAĞ', 'YUKARI', 'AŞAĞI', 'GÖREV', 'KURTAR', 'merhaba'];
      let s = seed;
      for (let t = 0; t < 600; t++) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        const who = names[s % names.length];
        const text = cmds[(s >> 4) % cmds.length];
        const c = parseCommand(text);
        if (c) enqueue(w, who, c);
        step(w);
      }
      return JSON.stringify(w);
    }
    expect(run(99)).toBe(run(99));
    expect(run(99)).not.toBe(run(100));
  });
});
