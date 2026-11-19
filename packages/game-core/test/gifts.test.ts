import { describe, expect, it } from 'vitest';
import { GIFT, MOVE_COOLDOWN_SURVIVOR } from '../src/config';
import { isDark, isNight, setDifficulty, startMatch, step, stopMatch, addPlayer, createWorld, enqueue, litTiles, visionRadius } from '../src/world';
import { DAY_TICKS, VISION } from '../src/config';
import type { GameEvent, GameWorld, GiftTier, Player } from '../src/types';

function started(seed: number, names: string[]): GameWorld {
  const w = createWorld(seed);
  for (const n of names) addPlayer(w, n);
  const r = startMatch(w);
  if (!r.ok) throw new Error(r.reason);
  return w;
}

function role(w: GameWorld, role: Player['role']): Player {
  const p = Object.values(w.players).find((v) => v.role === role);
  if (!p) throw new Error(`rol yok: ${role}`);
  return p;
}

function gift(w: GameWorld, name: string, tier: GiftTier): void {
  enqueue(w, name, { type: 'gift', tier, giftName: 'test' });
}

function eventsOf(w: GameWorld, type: GameEvent['type']): GameEvent[] {
  return w.events.filter((e) => e.type === type);
}

function clearCooldowns(w: GameWorld): void {
  for (const p of Object.values(w.players)) p.cooldown = 0;
}

describe('küçük hediye: hız bonusu', () => {
  it('gönderen oyuncunun hareket beklemesi yarıya iner', () => {
    const w = started(1, ['Ali', 'Ayşe']);
    const s = role(w, 'survivor');
    const other = Object.values(w.players).find((p) => p !== s && p.role === 'survivor') ?? role(w, 'killer');
    w.map.tiles.fill(0);
    s.x = 5;
    s.y = 5;
    other.x = 1;
    other.y = 1;
    gift(w, s.name, 'small');
    step(w);
    expect(s.speedTicks).toBe(GIFT.speedTicks);
    clearCooldowns(w);
    enqueue(w, s.name, { type: 'move', dir: 'right' });
    step(w);
    expect(s.cooldown).toBe(Math.floor(MOVE_COOLDOWN_SURVIVOR * GIFT.speedCooldownFactor));
  });

  it('oyuncu olmayan izleyicinin küçük hediyesi yok sayılır', () => {
    const w = started(2, ['Ali', 'Ayşe']);
    gift(w, 'Yabancı', 'small');
    step(w);
    expect(w.events).toContainEqual({ type: 'gift-ignored', tier: 'small', by: 'yabancı' });
  });
});

describe('orta hediye: kalkan', () => {
  it('kalkanlı hayatta kalanı yakalamak engellenir ve kalkan tüketilir', () => {
    const w = started(3, ['Ali', 'Ayşe', 'Can']);
    const killer = role(w, 'killer');
    const victim = Object.values(w.players).find((p) => p.role === 'survivor') as Player;
    w.map.tiles.fill(0);
    killer.x = 4;
    killer.y = 4;
    victim.x = 5;
    victim.y = 4;
    victim.immunity = 0;
    gift(w, victim.name, 'medium');
    step(w);
    expect(victim.shieldTicks).toBeGreaterThan(0);

    clearCooldowns(w);
    enqueue(w, killer.name, { type: 'task' });
    step(w);
    expect(victim.caught).toBe(false);
    expect(victim.shieldTicks).toBe(0);
    expect(w.events.some((e) => e.type === 'shield-blocked')).toBe(true);
  });

  it('katil orta hediye ile kalkan alamaz', () => {
    const w = started(4, ['Ali', 'Ayşe']);
    const killer = role(w, 'killer');
    gift(w, killer.name, 'medium');
    step(w);
    expect(w.events).toContainEqual({ type: 'gift-ignored', tier: 'medium', by: killer.key });
    expect(killer.shieldTicks).toBe(0);
  });
});

describe('büyük hediye: canavarı güçlendirme', () => {
  it('katil hızlanır ve yakalama beklemesi kısalır', () => {
    const w = started(5, ['Ali', 'Ayşe']);
    const killer = role(w, 'killer');
    const someone = Object.values(w.players).find((p) => p.role === 'survivor') as Player;
    gift(w, someone.name, 'big');
    step(w);
    expect(w.bossTicks).toBe(GIFT.bossTicks);
    expect(w.events.some((e) => e.type === 'gift-effect' && e.effect === 'boss' && e.target === killer.key)).toBe(true);

    w.map.tiles.fill(0);
    killer.x = 2;
    killer.y = 2;
    clearCooldowns(w);
    enqueue(w, killer.name, { type: 'move', dir: 'right' });
    step(w);
    expect(killer.cooldown).toBeLessThan(isNight(w.tick) ? 4 : 5);
  });
});

describe('özel hediye: harita olayları', () => {
  it('karartma: gündüzde bile görüş gece değerine düşer ve sis aktif olur', () => {
    const w = started(6, ['Ali', 'Ayşe']);
    expect(isDark(w)).toBe(false);
    const survivor = role(w, 'survivor');
    expect(visionRadius(w, survivor)).toBe(VISION.survivorDay);
    w.blackoutTicks = GIFT.blackoutTicks;
    expect(isDark(w)).toBe(true);
    expect(visionRadius(w, survivor)).toBe(VISION.survivorNight);
    const lit = litTiles(w).filter(Boolean).length;
    w.blackoutTicks = 0;
    expect(litTiles(w).filter(Boolean).length).toBeGreaterThan(lit);
  });

  it('özel hediye ya karartma ya jeneratör sıçraması yapar, seçim tohumdan deterministiktir', () => {
    const run = (seed: number) => {
      const w = started(seed, ['Ali', 'Ayşe']);
      gift(w, 'Ali', 'special');
      step(w);
      return { ev: w.events.map((e) => e.type), blackout: w.blackoutTicks, gens: w.generators.map((g) => g.progress) };
    };
    expect(run(7)).toEqual(run(7));
    const r = run(7);
    const surged = r.gens.some((p) => p > 0);
    expect(surged !== (r.blackout > 0)).toBe(true);
  });

  it('jeneratör sıçraması tamamlanmamış jeneratörlere ilerleme ekler', () => {
    const w = started(8, ['Ali', 'Ayşe']);
    // Sıçramanın tetiklendiği tohum/durum: rng seçimi karartmaya düşmeyecek şekilde ayarlanır
    w.rngState = 0;
    let surgeSeen = false;
    for (let i = 0; i < 6 && !surgeSeen; i++) {
      w.blackoutTicks = 0;
      gift(w, 'Ali', 'special');
      step(w);
      surgeSeen = w.events.some((e) => e.type === 'gift-effect' && e.effect === 'surge');
    }
    expect(surgeSeen).toBe(true);
    expect(w.generators.some((g) => g.progress >= GIFT.surgeProgress)).toBe(true);
  });
});

describe('hediye kuralları genel', () => {
  it('lobide gelen hediye etki yaratmaz', () => {
    const w = createWorld(9);
    addPlayer(w, 'Ali');
    gift(w, 'Ali', 'big');
    step(w);
    expect(w.bossTicks).toBe(0);
  });

  it('hediye komutu oyuncu bekleme süresine takılmaz', () => {
    const w = started(10, ['Ali', 'Ayşe']);
    const s = role(w, 'survivor');
    s.cooldown = 10;
    gift(w, s.name, 'small');
    step(w);
    expect(s.speedTicks).toBe(GIFT.speedTicks);
  });

  it('hız bonusu ve kalkan süreleri tick ile azalır', () => {
    const w = started(11, ['Ali', 'Ayşe']);
    const s = role(w, 'survivor');
    s.speedTicks = 3;
    s.shieldTicks = 2;
    step(w);
    expect(s.speedTicks).toBe(2);
    expect(s.shieldTicks).toBe(1);
  });
});

describe('yayıncı kontrolleri (zorluk ve durdurma)', () => {
  it('zorluk yalnızca lobide değiştirilebilir', () => {
    const w = createWorld(31);
    addPlayer(w, 'A');
    addPlayer(w, 'B');
    expect(setDifficulty(w, 'hard')).toBe(true);
    startMatch(w);
    expect(setDifficulty(w, 'easy')).toBe(false);
    expect(w.difficulty).toBe('hard');
  });

  it('zor modda görev ilerlemesi daha azdır', () => {
    const w = started(32, ['Ali', 'Ayşe']);
    w.difficulty = 'hard';
    const s = role(w, 'survivor');
    const gen = w.generators[0];
    s.x = gen.x;
    s.y = gen.y;
    w.map.tiles.fill(0);
    const neighbour = [
      { x: gen.x + 1, y: gen.y }, { x: gen.x - 1, y: gen.y }, { x: gen.x, y: gen.y + 1 }, { x: gen.x, y: gen.y - 1 },
    ].find((c) => c.x > 0 && c.y > 0 && c.x < w.map.width - 1 && c.y < w.map.height - 1) as { x: number; y: number };
    s.x = neighbour.x;
    s.y = neighbour.y;
    s.cooldown = 0;
    enqueue(w, s.name, { type: 'task' });
    step(w);
    expect(gen.progress).toBe(8);
  });

  it('maç durdurulunca kazanan olmadan biter', () => {
    const w = started(33, ['Ali', 'Ayşe']);
    expect(stopMatch(w)).toBe(true);
    expect(w.phase).toBe('ended');
    expect(w.winner).toBeNull();
    expect(w.winReason).toBe('host-stopped');
    expect(stopMatch(w)).toBe(false);
  });
});
