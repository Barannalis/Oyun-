import {
  CYCLE_TICKS,
  DAY_TICKS,
  DIFFICULTY,
  GENERATOR_COUNT,
  GENERATOR_REQUIRED_PROGRESS,
  GIFT,
  MAP_HEIGHT,
  MAP_WIDTH,
  MATCH_TICKS,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  MAX_QUEUE_LENGTH,
  MIN_PLAYERS_TO_START,
  MOVE_COOLDOWN_KILLER_DAY,
  MOVE_COOLDOWN_KILLER_NIGHT,
  MOVE_COOLDOWN_SURVIVOR,
  RESCUE_COOLDOWN,
  RESCUE_IMMUNITY_TICKS,
  RESCUE_REQUIRED,
  SCORE,
  TASK_COOLDOWN,
  VISION,
} from './config';
import { generateMap, isWalkable, manhattan, placeGenerators } from './map';
import { nextInt, type RngState } from './rng';
import type {
  Command,
  Difficulty,
  Direction,
  GameWorld,
  GiftTier,
  Intent,
  Player,
  Position,
  StartResult,
  WinReason,
  Winner,
} from './types';

const DELTAS: Record<Direction, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

export function normalizeName(raw: string): string {
  return raw.trim().replace(/^@/, '').slice(0, MAX_NAME_LENGTH);
}

/** Kullanıcı adından benzersiz anahtar üretir. "@Ali" ve "ali" aynı oyuncudur. */
export function userKey(name: string): string {
  return normalizeName(name).toLocaleLowerCase('tr-TR');
}

export function createWorld(seed: number): GameWorld {
  const rng: RngState = { s: seed | 0 };
  const map = generateMap(rng, MAP_WIDTH, MAP_HEIGHT);
  const spots = placeGenerators(map, rng, GENERATOR_COUNT);
  return {
    seed: seed | 0,
    rngState: rng.s,
    tick: 0,
    phase: 'lobby',
    map,
    players: {},
    generators: spots.map((s, id) => ({ id, x: s.x, y: s.y, progress: 0, done: false })),
    queue: [],
    events: [],
    winner: null,
    winReason: null,
    bossTicks: 0,
    blackoutTicks: 0,
    difficulty: 'normal',
  };
}

export type AddPlayerResult =
  | { ok: true; key: string }
  | { ok: false; reason: 'invalid_name' | 'name_taken' | 'room_full' | 'match_in_progress' };

/**
 * Lobiye doğrudan oyuncu ekler (soket girişi için). Yorumla katılımda
 * komut sırasından geçer, bu fonksiyon onu atlar.
 */
export function addPlayer(world: GameWorld, rawName: string): AddPlayerResult {
  const name = normalizeName(rawName);
  if (name.length === 0) return { ok: false, reason: 'invalid_name' };
  if (world.phase !== 'lobby') return { ok: false, reason: 'match_in_progress' };
  const key = userKey(name);
  if (world.players[key]) return { ok: false, reason: 'name_taken' };
  if (Object.keys(world.players).length >= MAX_PLAYERS) return { ok: false, reason: 'room_full' };
  world.players[key] = {
    key,
    name,
    role: 'survivor',
    x: -1,
    y: -1,
    caught: false,
    rescueProgress: 0,
    immunity: 0,
    cooldown: 0,
    score: 0,
    connected: true,
    speedTicks: 0,
    shieldTicks: 0,
  };
  return { ok: true, key };
}

/** Zorluğu değiştirir. Yalnızca lobide çalışır. */
export function setDifficulty(world: GameWorld, difficulty: Difficulty): boolean {
  if (world.phase !== 'lobby') return false;
  world.difficulty = difficulty;
  return true;
}

/** Yayıncı maçı durdurur. Kazanan yoktur. */
export function stopMatch(world: GameWorld): boolean {
  if (world.phase !== 'playing') return false;
  finish(world, null, 'host-stopped');
  return true;
}

/** Yalnızca lobide çalışır. Maç başladıysa oyuncu silinmez. */
export function removePlayer(world: GameWorld, key: string): boolean {
  if (world.phase !== 'lobby' || !world.players[key]) return false;
  delete world.players[key];
  return true;
}

export function setConnected(world: GameWorld, key: string, connected: boolean): boolean {
  const p = world.players[key];
  if (!p) return false;
  p.connected = connected;
  return true;
}

/**
 * Bir komutu sıraya alır. Uygulama bir sonraki step() çağrısında yapılır.
 * Böylece komutlar tick sınırında, sırayla ve deterministik işlenir.
 */
export function enqueue(world: GameWorld, name: string, command: Command): boolean {
  if (world.queue.length >= MAX_QUEUE_LENGTH) return false;
  const trimmed = normalizeName(name);
  if (trimmed.length === 0) return false;
  world.queue.push({ userKey: userKey(trimmed), name: trimmed, command });
  return true;
}

export function step(world: GameWorld): void {
  world.events = [];
  if (world.phase === 'ended') {
    world.queue = [];
    return;
  }
  if (world.phase === 'playing') {
    world.tick += 1;
    for (const p of Object.values(world.players)) {
      if (p.cooldown > 0) p.cooldown -= 1;
      if (p.immunity > 0) p.immunity -= 1;
      if (p.speedTicks > 0) p.speedTicks -= 1;
      if (p.shieldTicks > 0) p.shieldTicks -= 1;
    }
    if (world.bossTicks > 0) world.bossTicks -= 1;
    if (world.blackoutTicks > 0) world.blackoutTicks -= 1;
  }

  const intents = world.queue;
  world.queue = [];
  for (const intent of intents) apply(world, intent);

  if (world.phase === 'playing') checkEnd(world);
}

/**
 * Lobiden maça geçer. Rol dağıtır ve oyuncuları haritaya yerleştirir.
 * Katil rastgele seçilir. Katil, diğer oyunculardan uzağa doğar.
 */
export function startMatch(world: GameWorld): StartResult {
  if (world.phase !== 'lobby') return { ok: false, reason: 'match_already_started' };
  const keys = Object.keys(world.players);
  if (keys.length < MIN_PLAYERS_TO_START) return { ok: false, reason: 'not_enough_players' };

  const rng: RngState = { s: world.rngState };
  const killerKey = keys[nextInt(rng, keys.length)];
  const ordered = [...keys.filter((k) => k !== killerKey), killerKey];
  const taken: Position[] = [];

  for (const key of ordered) {
    const p = world.players[key];
    const isKiller = key === killerKey;
    p.role = isKiller ? 'killer' : 'survivor';
    p.caught = false;
    p.rescueProgress = 0;
    p.immunity = 0;
    p.cooldown = 0;
    p.speedTicks = 0;
    p.shieldTicks = 0;
    const pos = pickCell(world, rng, taken, isKiller ? 10 : 4);
    p.x = pos.x;
    p.y = pos.y;
    taken.push(pos);
  }

  world.rngState = rng.s;
  world.phase = 'playing';
  world.tick = 0;
  world.bossTicks = 0;
  world.blackoutTicks = 0;
  return { ok: true };
}

export function isNight(tick: number): boolean {
  return tick % CYCLE_TICKS >= DAY_TICKS;
}

/** Karanlık: gece veya karartma olayı. Görüş alanı ve sis buna göre belirlenir. */
export function isDark(world: GameWorld): boolean {
  return isNight(world.tick) || world.blackoutTicks > 0;
}

export function visionRadius(world: GameWorld, p: Player): number {
  const dark = isDark(world);
  if (p.role === 'killer') return dark ? VISION.killerNight : VISION.killerDay;
  return dark ? VISION.survivorNight : VISION.survivorDay;
}

/** Aktif oyuncuların görüş alanındaki kareler (indeks = y * width + x). */
export function litTiles(world: GameWorld): boolean[] {
  const { width, height } = world.map;
  const lit = new Array<boolean>(width * height).fill(false);
  for (const p of Object.values(world.players)) {
    if (p.caught || p.x < 0) continue;
    const r = visionRadius(world, p);
    const r2 = r * r;
    for (let y = Math.max(0, p.y - r); y <= Math.min(height - 1, p.y + r); y++) {
      for (let x = Math.max(0, p.x - r); x <= Math.min(width - 1, p.x + r); x++) {
        const dx = x - p.x;
        const dy = y - p.y;
        if (dx * dx + dy * dy <= r2) lit[y * width + x] = true;
      }
    }
  }
  return lit;
}

function apply(world: GameWorld, intent: Intent): void {
  const { command } = intent;
  if (command.type === 'join') {
    joinLobby(world, intent.name);
    return;
  }
  if (world.phase !== 'playing') return;

  if (command.type === 'gift') {
    applyGift(world, intent.userKey, command.tier);
    return;
  }

  const player = world.players[intent.userKey];
  if (!player || player.caught || player.cooldown > 0) return;

  switch (command.type) {
    case 'move':
      move(world, player, command.dir);
      break;
    case 'task':
      if (player.role === 'killer') attack(world, player);
      else work(world, player);
      break;
    case 'rescue':
      if (player.role === 'survivor') rescue(world, player);
      break;
  }
}

/** Yorumla GİR: başarılıysa olay üretir, aynı kişi ikinci kez girerse sessizce yok sayılır. */
function joinLobby(world: GameWorld, name: string): void {
  const result = addPlayer(world, name);
  if (result.ok) world.events.push({ type: 'joined', key: result.key });
}

/**
 * Hediye etkisi. Hediyeyi gönderen oyuncu değilse, kişisel etkiler yok sayılır
 * ve gift-ignored olayı üretilir. Büyük ve özel etkiler herkes için geçerlidir.
 */
function applyGift(world: GameWorld, key: string, tier: GiftTier): void {
  const p = world.players[key];
  const ignored = (): void => {
    world.events.push({ type: 'gift-ignored', tier, by: key });
  };

  switch (tier) {
    case 'small': {
      if (!p || p.caught) return ignored();
      p.speedTicks = GIFT.speedTicks;
      world.events.push({ type: 'gift-effect', tier, effect: 'speed', by: key, target: key });
      return;
    }
    case 'medium': {
      if (!p || p.caught || p.role !== 'survivor') return ignored();
      p.shieldTicks = GIFT.shieldTicks;
      world.events.push({ type: 'gift-effect', tier, effect: 'shield', by: key, target: key });
      return;
    }
    case 'big': {
      world.bossTicks = GIFT.bossTicks;
      const killer = Object.values(world.players).find((v) => v.role === 'killer');
      world.events.push({ type: 'gift-effect', tier, effect: 'boss', by: key, target: killer?.key ?? null });
      return;
    }
    case 'special': {
      const rng: RngState = { s: world.rngState };
      const blackout = nextInt(rng, 2) === 0;
      world.rngState = rng.s;
      if (blackout) {
        world.blackoutTicks = GIFT.blackoutTicks;
        world.events.push({ type: 'gift-effect', tier, effect: 'blackout', by: key, target: null });
      } else {
        surge(world, key);
        world.events.push({ type: 'gift-effect', tier, effect: 'surge', by: key, target: null });
      }
      return;
    }
  }
}

/** Tüm tamamlanmamış jeneratörlere ilerleme ekler. */
function surge(world: GameWorld, by: string): void {
  for (const gen of world.generators) {
    if (gen.done) continue;
    gen.progress = Math.min(GENERATOR_REQUIRED_PROGRESS, gen.progress + GIFT.surgeProgress);
    if (gen.progress >= GENERATOR_REQUIRED_PROGRESS) {
      gen.done = true;
      world.events.push({ type: 'generator-done', generatorId: gen.id, by });
    }
  }
}

function move(world: GameWorld, p: Player, dir: Direction): void {
  const { dx, dy } = DELTAS[dir];
  const nx = p.x + dx;
  const ny = p.y + dy;
  if (!isWalkable(world.map, nx, ny)) return;
  p.x = nx;
  p.y = ny;
  p.cooldown = moveCooldown(world, p);
}

function moveCooldown(world: GameWorld, p: Player): number {
  let cd: number;
  if (p.role === 'survivor') {
    cd = MOVE_COOLDOWN_SURVIVOR;
  } else {
    cd = isNight(world.tick) ? MOVE_COOLDOWN_KILLER_NIGHT : MOVE_COOLDOWN_KILLER_DAY;
    cd = Math.max(2, cd + DIFFICULTY[world.difficulty].killerMoveDelta);
    if (world.bossTicks > 0) cd = Math.max(GIFT.bossMoveCooldownMin, cd - 2);
  }
  if (p.speedTicks > 0) cd = Math.max(1, Math.floor(cd * GIFT.speedCooldownFactor));
  return cd;
}

/** Hayatta kalan, komşu jeneratörde çalışır. */
function work(world: GameWorld, p: Player): void {
  const gen = world.generators.find((g) => !g.done && manhattan(g, p) === 1);
  if (!gen) return;
  gen.progress = Math.min(GENERATOR_REQUIRED_PROGRESS, gen.progress + DIFFICULTY[world.difficulty].taskProgress);
  p.score += SCORE.task;
  p.cooldown = TASK_COOLDOWN;
  world.events.push({ type: 'task-progress', generatorId: gen.id, by: p.key, progress: gen.progress });
  if (gen.progress >= GENERATOR_REQUIRED_PROGRESS) {
    gen.done = true;
    world.events.push({ type: 'generator-done', generatorId: gen.id, by: p.key });
  }
}

/** Katil, komşu korunmayan bir hayatta kalanı yakalar. Kalkan varsa yakalama engellenir. */
function attack(world: GameWorld, p: Player): void {
  const victim = Object.values(world.players).find(
    (v) => v.role === 'survivor' && !v.caught && v.immunity === 0 && manhattan(v, p) <= 1,
  );
  if (!victim) return;
  const cooldown = world.bossTicks > 0 ? GIFT.bossCatchCooldown : DIFFICULTY[world.difficulty].catchCooldown;
  p.cooldown = cooldown;

  if (victim.shieldTicks > 0) {
    victim.shieldTicks = 0;
    world.events.push({ type: 'shield-blocked', victim: victim.key, by: p.key });
    return;
  }

  victim.caught = true;
  victim.rescueProgress = 0;
  p.score += SCORE.catch;
  world.events.push({ type: 'caught', victim: victim.key, by: p.key });
}

/** Hayatta kalan, komşu yakalanmış oyuncuyu kurtarmaya çalışır. */
function rescue(world: GameWorld, p: Player): void {
  const target = Object.values(world.players).find(
    (v) => v.role === 'survivor' && v.caught && manhattan(v, p) <= 1,
  );
  if (!target) return;
  target.rescueProgress += 1;
  p.cooldown = RESCUE_COOLDOWN;
  if (target.rescueProgress < RESCUE_REQUIRED) return;

  target.caught = false;
  target.rescueProgress = 0;
  target.immunity = RESCUE_IMMUNITY_TICKS;
  p.score += SCORE.rescue;
  world.events.push({ type: 'rescued', victim: target.key, by: p.key });
}

function checkEnd(world: GameWorld): void {
  if (world.generators.length > 0 && world.generators.every((g) => g.done)) {
    finish(world, 'survivors', 'generators-done');
    return;
  }
  const survivors = Object.values(world.players).filter((p) => p.role === 'survivor');
  if (survivors.length > 0 && survivors.every((p) => p.caught)) {
    finish(world, 'killer', 'all-caught');
    return;
  }
  if (world.tick >= MATCH_TICKS) finish(world, 'killer', 'timeout');
}

function finish(world: GameWorld, winner: Winner | null, reason: WinReason): void {
  world.phase = 'ended';
  world.winner = winner;
  world.winReason = reason;
  world.queue = [];
  world.events.push({ type: 'ended', winner, reason });
}

/** Boş, yürünebilir bir kare seçer. Mümkünse diğer konumlara minDist uzaklıkta olur. */
function pickCell(world: GameWorld, rng: RngState, taken: Position[], minDist: number): Position {
  const candidates: Position[] = [];
  for (let y = 0; y < world.map.height; y++) {
    for (let x = 0; x < world.map.width; x++) {
      if (isWalkable(world.map, x, y)) candidates.push({ x, y });
    }
  }
  const spaced = candidates.filter((c) => taken.every((t) => manhattan(c, t) >= Math.max(1, minDist)));
  const pool = spaced.length > 0 ? spaced : candidates;
  return pool[nextInt(rng, pool.length)];
}
