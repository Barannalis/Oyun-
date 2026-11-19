/**
 * Denge ölçümü: botlarla çok sayıda maç simüle eder ve sonuçları raporlar.
 * Çalıştırma: npx tsx prototype/sim/balance.ts [maç_sayısı] [oyuncu_sayısı] [tuning_json]
 */
import {
  MATCH_TICKS,
  TICK_RATE,
  addPlayer,
  createWorld,
  enqueue,
  startMatch,
  step,
  type GameEvent,
  type GameWorld,
} from '@ttl/game-core';
import { DEFAULT_TUNING, decide, type BotTuning } from '../src/bots';

interface Result {
  winner: 'survivors' | 'killer' | 'none';
  reason: string;
  seconds: number;
  catches: number;
  rescues: number;
  generators: number;
  shieldBlocks: number;
}

function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function runMatch(seed: number, players: number, tuning: BotTuning): Result {
  const w: GameWorld = createWorld(seed);
  for (let i = 0; i < players; i++) addPlayer(w, `bot${i + 1}`);
  startMatch(w);
  const rand = lcg(seed * 7919 + 13);
  const bots = Object.values(w.players);
  const phase = bots.map(() => Math.floor(rand() * 10));
  const r: Result = { winner: 'none', reason: '', seconds: 0, catches: 0, rescues: 0, generators: 0, shieldBlocks: 0 };

  while (w.phase === 'playing' && w.tick <= MATCH_TICKS + 5) {
    bots.forEach((bot, i) => {
      if (bot.caught || bot.x < 0) return;
      const every = bot.role === 'killer' ? tuning.killerEvery : tuning.survivorEvery;
      if ((w.tick + phase[i]) % every !== 0) return;
      const cmd = decide(w, bot, tuning, rand);
      if (cmd) enqueue(w, bot.name, cmd);
    });
    step(w);
    for (const e of w.events as GameEvent[]) {
      if (e.type === 'caught') r.catches++;
      else if (e.type === 'rescued') r.rescues++;
      else if (e.type === 'generator-done') r.generators++;
      else if (e.type === 'shield-blocked') r.shieldBlocks++;
      else if (e.type === 'ended') {
        r.winner = e.winner ?? 'none';
        r.reason = e.reason;
      }
    }
  }
  r.seconds = w.tick / TICK_RATE;
  return r;
}

function summarize(results: Result[]) {
  const n = results.length;
  const avg = (f: (r: Result) => number) => results.reduce((s, r) => s + f(r), 0) / n;
  const pct = (f: (r: Result) => boolean) => (results.filter(f).length / n) * 100;
  const reasons: Record<string, number> = {};
  for (const r of results) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
  return {
    matches: n,
    survivorWinPct: +pct((r) => r.winner === 'survivors').toFixed(1),
    killerWinPct: +pct((r) => r.winner === 'killer').toFixed(1),
    reasons,
    avgMinutes: +(avg((r) => r.seconds) / 60).toFixed(2),
    avgCatches: +avg((r) => r.catches).toFixed(2),
    avgRescues: +avg((r) => r.rescues).toFixed(2),
    avgGenerators: +avg((r) => r.generators).toFixed(2),
    avgShieldBlocks: +avg((r) => r.shieldBlocks).toFixed(2),
  };
}

const isMain = process.argv[1]?.endsWith('balance.ts');
if (isMain) {
  const matches = Number(process.argv[2] ?? 300);
  const players = Number(process.argv[3] ?? 5);
  const override = process.argv[4] ? (JSON.parse(process.argv[4]) as Partial<BotTuning>) : {};
  const tuning = { ...DEFAULT_TUNING, ...override };
  const results: Result[] = [];
  for (let s = 1; s <= matches; s++) results.push(runMatch(s, players, tuning));
  console.log(JSON.stringify({ players, tuning, ...summarize(results) }, null, 2));
}
