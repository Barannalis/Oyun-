import { isWalkable, manhattan, type Direction, type GameWorld, type Player } from '@ttl/game-core';

/**
 * Prototip bot yapay zekâsı. Tarayıcıdan ve simülasyondan bağımsızdır; yalnızca
 * dünya durumunu okuyup bir komut döndürür.
 */
export type BotCommand = { type: 'move'; dir: Direction } | { type: 'task' } | { type: 'rescue' };

const DIRS: Array<{ dx: number; dy: number; dir: Direction }> = [
  { dx: 0, dy: -1, dir: 'up' },
  { dx: 0, dy: 1, dir: 'down' },
  { dx: -1, dy: 0, dir: 'left' },
  { dx: 1, dy: 0, dir: 'right' },
];

export interface BotTuning {
  /** Katilin kendi karar aralığı (tick). Kuralın bekleme süresine yakın olmalı. */
  killerEvery: number;
  /** Hayatta kalanın karar aralığı (tick). */
  survivorEvery: number;
  /** Hayatta kalan bu mesafede (Manhattan) katili görünce kaçar. */
  fleeRange: number;
  /** Yakalanmış arkadaşı kurtarma olasılığı, her karar için. */
  rescueChance: number;
  /** Yakalanmış arkadaşa gitme mesafesi (Manhattan). */
  rescueRange: number;
}

/** Ölçülmüş denge: 1000 maçta hayatta kalanlar ~%50, katil ~%50 (bkz. prototype/sim/balance.ts). */
export const DEFAULT_TUNING: BotTuning = {
  killerEvery: 6,
  survivorEvery: 7,
  fleeRange: 2,
  rescueChance: 0.9,
  rescueRange: 12,
};

function firstStep(world: GameWorld, from: { x: number; y: number }, isGoal: (x: number, y: number) => boolean): Direction | null {
  const { width, height } = world.map;
  const start = from.y * width + from.x;
  const seen = new Uint8Array(width * height);
  const first = new Int8Array(width * height).fill(-1);
  const queue: number[] = [start];
  seen[start] = 1;
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    const cx = cur % width;
    const cy = Math.floor(cur / width);
    if (cur !== start && isGoal(cx, cy)) return DIRS[first[cur]].dir;
    for (let d = 0; d < 4; d++) {
      const nx = cx + DIRS[d].dx;
      const ny = cy + DIRS[d].dy;
      if (!isWalkable(world.map, nx, ny)) continue;
      const idx = ny * width + nx;
      if (seen[idx]) continue;
      seen[idx] = 1;
      first[idx] = cur === start ? d : first[cur];
      queue.push(idx);
    }
  }
  return null;
}

function fleeStep(world: GameWorld, p: { x: number; y: number }, danger: { x: number; y: number }): Direction | null {
  let best: Direction | null = null;
  let bestD = manhattan(p, danger);
  for (const d of DIRS) {
    const nx = p.x + d.dx;
    const ny = p.y + d.dy;
    if (!isWalkable(world.map, nx, ny)) continue;
    const dist = manhattan({ x: nx, y: ny }, danger);
    if (dist > bestD) {
      bestD = dist;
      best = d.dir;
    }
  }
  return best;
}

/** Bir botun bu andaki komutu. Yapacak bir şey yoksa null. */
export function decide(world: GameWorld, bot: Player, tuning: BotTuning = DEFAULT_TUNING, rand: () => number = Math.random): BotCommand | null {
  const alive = Object.values(world.players).filter((q) => q.x >= 0);
  if (bot.role === 'killer') {
    const targets = alive.filter((q) => q.role === 'survivor' && !q.caught);
    if (targets.length === 0) return null;
    if (targets.some((t) => manhattan(t, bot) === 1)) return { type: 'task' };
    const dir = firstStep(world, bot, (x, y) => targets.some((t) => manhattan({ x, y }, t) === 1));
    return dir ? { type: 'move', dir } : null;
  }
  const killer = alive.find((q) => q.role === 'killer');
  if (killer && manhattan(killer, bot) <= tuning.fleeRange) {
    const dir = fleeStep(world, bot, killer);
    if (dir) return { type: 'move', dir };
  }
  // Yakalanmış arkadaş: yanındaysa kurtar, değilse katil uzaksa yanına git.
  const downed = alive.find((q) => q.role === 'survivor' && q.caught && manhattan(q, bot) === 1);
  if (downed && bot.cooldown === 0 && rand() < tuning.rescueChance) return { type: 'rescue' };
  const far = alive.filter((q) => q.role === 'survivor' && q.caught);
  const target = far.find((q) => (!killer || manhattan(killer, q) > 3) && manhattan(q, bot) <= tuning.rescueRange);
  if (target && !downed) {
    const dir = firstStep(world, bot, (x, y) => manhattan({ x, y }, target) === 1);
    if (dir) return { type: 'move', dir };
  }
  const gens = world.generators.filter((g) => !g.done);
  if (gens.length === 0) return null;
  if (gens.some((g) => manhattan(g, bot) === 1)) return { type: 'task' };
  const dir = firstStep(world, bot, (x, y) => gens.some((g) => manhattan({ x, y }, g) === 1));
  return dir ? { type: 'move', dir } : null;
}
