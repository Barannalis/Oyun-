import {
  DIFFICULTY_LABELS,
  GENERATOR_REQUIRED_PROGRESS,
  MAP_HEIGHT,
  MAP_WIDTH,
  MATCH_TICKS,
  TICK_MS,
  TICK_RATE,
  TILE_WALL,
  createWorld,
  enqueue,
  isDark,
  litTiles,
  parseCommand,
  setDifficulty,
  startMatch,
  step,
  stopMatch,
  visionRadius,
  type Difficulty,
  type GameEvent,
  type GameWorld,
  type GiftEffect,
  type GiftTier,
  type Player,
} from '@ttl/game-core';

// ---- Sabitler ------------------------------------------------------------

const TILE = 22;
const W = MAP_WIDTH * TILE;
const H = MAP_HEIGHT * TILE;
const INK = '#1a0f33';

const PAL = {
  grassA: '#9be37f',
  grassB: '#8dd773',
  flower: ['#ffffff', '#ffd23f', '#ff9ac1'],
  brick: '#f2a46b',
  brickLight: '#ffd1a6',
  brickDark: '#c96f3e',
  mortar: '#b65f33',
  gen: '#ffd23f',
  genDone: '#5fe3a1',
  killer: '#8b5cf6',
  killerDark: '#4c1d95',
  sun: '#ffd23f',
  pink: '#ff6b9a',
  mint: '#51d6a8',
  violet: '#a78bfa',
  sky: '#58c4ff',
};

interface GiftCard { name: string; icon: string; tier: GiftTier; text: string }
const GIFTS: GiftCard[] = [
  { name: 'Gül', icon: '🌹', tier: 'small', text: 'Hız bonusu' },
  { name: 'Kalp', icon: '💜', tier: 'medium', text: 'Yakalanmayı engeller' },
  { name: 'Aslan', icon: '🦁', tier: 'big', text: 'Katil hızlanır' },
  { name: 'Evren', icon: '🌌', tier: 'special', text: 'Karartma veya sıçrama' },
];
const EFFECT_LABEL: Record<GiftEffect, string> = {
  speed: 'HIZ BONUSU', shield: 'KALKAN', boss: 'KATİL GÜÇLENDİ', blackout: 'KARARTMA', surge: 'JENERATÖR SIÇRADI',
};
const REASON: Record<string, string> = {
  'generators-done': 'Tüm jeneratörler çalıştırıldı',
  'all-caught': 'Tüm hayatta kalanlar yakalandı',
  timeout: 'Süre doldu',
  'host-stopped': 'Yayıncı durdurdu',
};

// ---- DOM -----------------------------------------------------------------

const canvas = document.getElementById('map') as HTMLCanvasElement;
canvas.width = W;
canvas.height = H;
const ctx = canvas.getContext('2d')!;
const fogCanvas = document.createElement('canvas');
fogCanvas.width = W;
fogCanvas.height = H;
const fctx = fogCanvas.getContext('2d')!;
const staticCanvas = document.createElement('canvas');
staticCanvas.width = W;
staticCanvas.height = H;
const $ = (id: string): HTMLElement => document.getElementById(id)!;
const $in = (id: string): HTMLInputElement => document.getElementById(id) as HTMLInputElement;
const $sel = (id: string): HTMLSelectElement => document.getElementById(id) as HTMLSelectElement;

// ---- Durum ---------------------------------------------------------------

let world: GameWorld = createWorld(Date.now() & 0x7fffffff);
let staticFor: GameWorld['map'] | null = null;
let botCounter = 0;
let acc = 0;
let last = performance.now();
let bigTimer: number | undefined;
let elapsed = 0;

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; kind: 'star' | 'dot' | 'heart'; size: number; g: number }
const particles: Particle[] = [];
const trail = new Map<string, { x: number; y: number; dx: number; dy: number; moved: number }>();
const rainUntil = { t: 0 };

// ---- Yardımcılar ---------------------------------------------------------

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 100000;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

function rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function center(p: { x: number; y: number }): { cx: number; cy: number } {
  return { cx: p.x * TILE + TILE / 2, cy: p.y * TILE + TILE / 2 };
}

function spawn(x: number, y: number, color: string, count: number, kind: Particle['kind'], speed = 90, g = 260): void {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = speed * (0.4 + Math.random() * 0.8);
    particles.push({
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.6, life: 0, max: 0.8 + Math.random() * 0.5,
      color, kind, size: 3 + Math.random() * 4, g,
    });
  }
}

function feed(text: string, kind = ''): void {
  const el = $('feed');
  const line = document.createElement('div');
  line.className = `line ${kind}`;
  line.textContent = text;
  el.appendChild(line);
  while (el.children.length > 4) el.removeChild(el.firstElementChild!);
}

function big(title: string, small = '', color = '#fff', ms = 1600): void {
  const b = $('big');
  const s = $('small');
  b.textContent = title;
  b.style.color = color;
  b.classList.remove('hidden');
  b.style.animation = 'none';
  void b.offsetWidth;
  b.style.animation = '';
  s.textContent = small;
  s.classList.toggle('hidden', small === '');
  if (bigTimer !== undefined) window.clearTimeout(bigTimer);
  bigTimer = window.setTimeout(() => {
    b.classList.add('hidden');
    s.classList.add('hidden');
  }, ms);
}

function nameOf(key: string): string {
  return world.players[key]?.name ?? key;
}

function handleEvent(e: GameEvent): void {
  switch (e.type) {
    case 'joined': {
      const p = world.players[e.key];
      if (p) {
        const c = center(p.x >= 0 ? p : { x: 15, y: 9 });
        spawn(c.cx, c.cy, PAL.sun, 8, 'star', 60, 120);
      }
      feed(`${nameOf(e.key)} oyuna katıldı`, 'good');
      break;
    }
    case 'task-progress':
      feed(`${nameOf(e.by)} jeneratöre çalıştı (%${e.progress})`);
      break;
    case 'generator-done': {
      const g = world.generators[e.generatorId];
      if (g) {
        const cx = g.x * TILE + TILE / 2;
        const cy = g.y * TILE + TILE / 2;
        for (const c of [PAL.sun, PAL.mint, PAL.pink, PAL.sky]) spawn(cx, cy, c, 10, 'dot', 130, 320);
      }
      feed(`${nameOf(e.by)} bir jeneratörü tamamladı`, 'good');
      big('JENERATÖR TAMAM', `${world.generators.filter((x) => x.done).length} / ${world.generators.length}`, '#5fe3a1', 1200);
      break;
    }
    case 'caught': {
      const v = world.players[e.victim];
      if (v && v.x >= 0) {
        const c = center(v);
        spawn(c.cx, c.cy, PAL.pink, 16, 'star', 150, 220);
      }
      feed(`${nameOf(e.by)}, ${nameOf(e.victim)} oyuncusunu yakaladı`, 'hot');
      big('YAKALANDI!', nameOf(e.victim), '#ff6b9a', 1300);
      break;
    }
    case 'rescued': {
      const v = world.players[e.victim];
      if (v && v.x >= 0) {
        const c = center(v);
        spawn(c.cx, c.cy, PAL.mint, 14, 'heart', 90, -40);
      }
      feed(`${nameOf(e.by)}, ${nameOf(e.victim)} oyuncusunu kurtardı`, 'good');
      big('KURTARILDI!', nameOf(e.victim), '#51d6a8', 1300);
      break;
    }
    case 'shield-blocked': {
      const v = world.players[e.victim];
      if (v && v.x >= 0) {
        const c = center(v);
        spawn(c.cx, c.cy, PAL.violet, 14, 'dot', 120, 0);
      }
      feed(`${nameOf(e.victim)} kalkanla korundu`, 'gift');
      big('KALKAN!', nameOf(e.victim), '#a78bfa', 1200);
      break;
    }
    case 'gift-effect': {
      const t = e.target ? world.players[e.target] : undefined;
      const c = t && t.x >= 0 ? center(t) : { cx: W / 2, cy: H / 2 };
      spawn(c.cx, c.cy, PAL.sun, 22, 'star', 170, 60);
      feed(`${nameOf(e.by)} hediye etkisi: ${EFFECT_LABEL[e.effect]}`, 'gift');
      big(EFFECT_LABEL[e.effect], nameOf(e.by), '#ffd23f', 1500);
      break;
    }
    case 'gift-ignored':
      feed(`${nameOf(e.by)} hediyesi bu maçta etki yaratmadı`);
      break;
    case 'ended':
      if (e.winner === null) big('MAÇ DURDU', REASON[e.reason] ?? '', '#ffffff', 2400);
      else {
        big(e.winner === 'survivors' ? 'HAYATTA KALANLAR KAZANDI!' : 'KATİL KAZANDI!', REASON[e.reason] ?? '', e.winner === 'survivors' ? '#5fe3a1' : '#ff6b9a', 2600);
        if (e.winner === 'survivors') rainUntil.t = elapsed + 3;
      }
      feed(`Maç bitti · ${REASON[e.reason] ?? ''}`, 'hot');
      break;
  }
}

function chat(user: string, text: string): void {
  const command = parseCommand(text);
  if (!command) {
    feed(`${user}: ${text} (tanınmadı)`);
    return;
  }
  feed(`${user}: ${text}`);
  enqueue(world, user, command);
}

function currentUser(): string {
  return $in('user').value.trim() || 'Ayşe';
}

function sendGift(card: GiftCard): void {
  const user = currentUser();
  feed(`${user} ${card.icon} ${card.name} gönderdi`, 'gift');
  enqueue(world, user, { type: 'gift', tier: card.tier, giftName: card.name });
}

// ---- Statik harita (zemin ve duvarlar) -----------------------------------

function buildStatic(): void {
  const c = staticCanvas.getContext('2d')!;
  const { width, height, tiles } = world.map;
  c.clearRect(0, 0, W, H);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = x * TILE;
      const py = y * TILE;
      const h = hash(`${x},${y}`);
      if (tiles[y * width + x] === TILE_WALL) {
        c.fillStyle = PAL.brickDark;
        c.fillRect(px, py, TILE, TILE);
        c.fillStyle = PAL.brick;
        c.fillRect(px + 1, py + 1, TILE - 2, TILE - 5);
        c.fillStyle = PAL.brickLight;
        c.fillRect(px + 2, py + 2, TILE - 4, 3);
        c.fillStyle = PAL.mortar;
        c.fillRect(px, py + TILE / 2, TILE, 1.5);
        c.fillRect(px + (h % 2 ? TILE / 3 : (TILE * 2) / 3), py + (h % 2 ? 0 : TILE / 2), 1.5, TILE / 2);
      } else {
        c.fillStyle = (x + y) % 2 === 0 ? PAL.grassA : PAL.grassB;
        c.fillRect(px, py, TILE, TILE);
        if (h % 6 === 0) {
          const fx = px + 4 + (h % 13);
          const fy = py + 4 + ((h >> 3) % 13);
          c.fillStyle = PAL.flower[h % PAL.flower.length];
          for (let k = 0; k < 5; k++) {
            const a = (k / 5) * Math.PI * 2;
            c.beginPath();
            c.arc(fx + Math.cos(a) * 2.2, fy + Math.sin(a) * 2.2, 1.6, 0, Math.PI * 2);
            c.fill();
          }
          c.fillStyle = PAL.sun;
          c.beginPath();
          c.arc(fx, fy, 1.4, 0, Math.PI * 2);
          c.fill();
        }
      }
    }
  }
  // Duvarların altına yumuşak gölge
  c.globalCompositeOperation = 'multiply';
  c.fillStyle = 'rgba(40,80,40,.12)';
  c.fillRect(0, 0, W, H);
  c.globalCompositeOperation = 'source-over';
  staticFor = world.map;
}

// ---- Karakterler ---------------------------------------------------------

function blink(t: number, seed: number): number {
  const phase = (t + seed * 0.37) % 3.2;
  return phase > 3.05 ? 0.15 : 1;
}

function drawShadow(cx: number, cy: number, r: number): void {
  ctx.fillStyle = 'rgba(26,15,51,.28)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.85, r * 0.9, r * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawSurvivor(p: Player, cx: number, cy: number, t: number, dx: number, dy: number, moving: boolean): void {
  const r = TILE * 0.42;
  const hue = hash(p.key) % 360;
  const bounce = p.caught ? 0 : Math.abs(Math.sin(t * (moving ? 14 : 4) + hue)) * (moving ? 3 : 1.4);
  const y = cy - bounce;
  drawShadow(cx, cy, r);

  // Gövde
  const fill = p.caught ? 'hsl(' + hue + ',10%,62%)' : `hsl(${hue},85%,64%)`;
  const edge = p.caught ? 'hsl(' + hue + ',10%,30%)' : `hsl(${hue},70%,28%)`;
  ctx.fillStyle = edge;
  ctx.beginPath();
  ctx.ellipse(cx, y + 1.5, r + 1.5, r * 0.98 + 1.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(cx, y, r, r * 0.98, 0, 0, Math.PI * 2);
  ctx.fill();
  // Parlaklık
  ctx.fillStyle = 'rgba(255,255,255,.35)';
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.35, y - r * 0.4, r * 0.3, r * 0.2, -0.5, 0, Math.PI * 2);
  ctx.fill();

  // Ayaklar
  ctx.fillStyle = edge;
  const step = moving ? Math.sin(t * 14) * 2.2 : 0;
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.45 + step, y + r * 0.9, r * 0.22, r * 0.14, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + r * 0.45 - step, y + r * 0.9, r * 0.22, r * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();

  if (p.caught) {
    // Yakalanmış: X gözler, üzgün ağız, etrafında ip halkası
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    for (const sx of [-1, 1]) {
      const ex = cx + sx * r * 0.36;
      const ey = y - r * 0.12;
      ctx.beginPath();
      ctx.moveTo(ex - 3, ey - 3);
      ctx.lineTo(ex + 3, ey + 3);
      ctx.moveTo(ex + 3, ey - 3);
      ctx.lineTo(ex - 3, ey + 3);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(cx, y + r * 0.5, r * 0.22, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = '#f5e6c8';
    ctx.beginPath();
    ctx.arc(cx, y, r + 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }

  // Gözler: pupil yöne bakar, kırpma animasyonu
  const eyeR = r * 0.3;
  const eyeY = y - r * 0.1;
  const lookX = Math.max(-1, Math.min(1, dx)) * eyeR * 0.28;
  const lookY = Math.max(-1, Math.min(1, dy)) * eyeR * 0.28;
  const b = blink(t, hue);
  for (const sx of [-1, 1]) {
    const ex = cx + sx * r * 0.36;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, eyeR, eyeR * b, 0, 0, Math.PI * 2);
    ctx.fill();
    if (b > 0.5) {
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(ex + lookX, eyeY + lookY, eyeR * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(ex + lookX - eyeR * 0.2, eyeY + lookY - eyeR * 0.2, eyeR * 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Yanaklar
  ctx.fillStyle = 'rgba(255,107,154,.55)';
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.62, y + r * 0.2, r * 0.18, r * 0.12, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + r * 0.62, y + r * 0.2, r * 0.18, r * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
  // Gülümseme
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, y + r * 0.12, r * 0.2, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();

  // Kalkan halesi
  if (p.shieldTicks > 0) {
    ctx.strokeStyle = 'rgba(167,139,250,.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, y, r + 5, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Koruma (kurtarılmış): dönen parıltılar
  if (p.immunity > 0) {
    for (let k = 0; k < 3; k++) {
      const a = t * 3 + (k * Math.PI * 2) / 3;
      const sx = cx + Math.cos(a) * (r + 6);
      const sy = y + Math.sin(a) * (r * 0.5 + 4);
      drawSpark(sx, sy, 4, PAL.mint);
    }
  }
}

function drawSpark(x: number, y: number, s: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.lineTo(x + s * 0.3, y - s * 0.3);
  ctx.lineTo(x + s, y);
  ctx.lineTo(x + s * 0.3, y + s * 0.3);
  ctx.lineTo(x, y + s);
  ctx.lineTo(x - s * 0.3, y + s * 0.3);
  ctx.lineTo(x - s, y);
  ctx.lineTo(x - s * 0.3, y - s * 0.3);
  ctx.closePath();
  ctx.fill();
}

function drawKiller(p: Player, cx: number, cy: number, t: number, dx: number, dy: number, moving: boolean): void {
  const r = TILE * 0.5;
  const bounce = Math.abs(Math.sin(t * (moving ? 16 : 5))) * (moving ? 3 : 1.6);
  const y = cy - bounce;
  drawShadow(cx, cy, r);

  // Boynuzlar
  ctx.fillStyle = PAL.killerDark;
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + sx * r * 0.45, y - r * 0.55);
    ctx.lineTo(cx + sx * r * 0.95, y - r * 1.25);
    ctx.lineTo(cx + sx * r * 0.7, y - r * 0.2);
    ctx.closePath();
    ctx.fill();
  }
  // Gövde
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.ellipse(cx, y + 1.5, r + 1.6, r + 1.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PAL.killer;
  ctx.beginPath();
  ctx.ellipse(cx, y, r, r, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.22)';
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.35, y - r * 0.4, r * 0.3, r * 0.2, -0.5, 0, Math.PI * 2);
  ctx.fill();

  // Kaşlar (kızgın)
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.7, y - r * 0.3);
  ctx.lineTo(cx - r * 0.12, y - r * 0.08);
  ctx.moveTo(cx + r * 0.7, y - r * 0.3);
  ctx.lineTo(cx + r * 0.12, y - r * 0.08);
  ctx.stroke();

  // Sarı gözler, yöne bakan pupiller
  const lookX = Math.max(-1, Math.min(1, dx)) * r * 0.1;
  const lookY = Math.max(-1, Math.min(1, dy)) * r * 0.1;
  for (const sx of [-1, 1]) {
    const ex = cx + sx * r * 0.38;
    const ey = y - r * 0.08;
    ctx.fillStyle = '#ffe14d';
    ctx.beginPath();
    ctx.ellipse(ex, ey, r * 0.26, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(ex + lookX, ey + lookY, r * 0.13, 0, Math.PI * 2);
    ctx.fill();
  }
  // Dişler
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.5, y + r * 0.35);
  for (let k = 0; k <= 4; k++) {
    const x = cx - r * 0.5 + (k * r) / 4;
    ctx.lineTo(x, y + r * (k % 2 ? 0.62 : 0.36));
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawGenerator(gen: GameWorld['generators'][number], t: number): void {
  const px = gen.x * TILE;
  const py = gen.y * TILE;
  const cx = px + TILE / 2;
  const cy = py + TILE / 2;
  const r = TILE * 0.42;
  const working = !gen.done && gen.progress > 0;
  const pulse = working ? 1 + Math.sin(t * 6) * 0.04 : 1;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(pulse, pulse);
  ctx.translate(-cx, -cy);
  // Gölge ve gövde
  ctx.fillStyle = 'rgba(26,15,51,.3)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.8, r * 0.95, r * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = INK;
  rr(ctx, cx - r - 1.5, cy - r - 1.5, r * 2 + 3, r * 2 + 3, 6);
  ctx.fill();
  ctx.fillStyle = gen.done ? PAL.genDone : PAL.gen;
  rr(ctx, cx - r, cy - r, r * 2, r * 2, 5);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.35)';
  rr(ctx, cx - r + 2, cy - r + 2, r * 2 - 4, 4, 2);
  ctx.fill();
  // Dişli simgesi
  const gx = cx;
  const gy = cy - 1;
  const spin = gen.done ? 0 : t * (working ? 3 : 0.8);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.arc(gx, gy, r * 0.42, 0, Math.PI * 2);
  ctx.stroke();
  for (let k = 0; k < 6; k++) {
    const a = spin + (k * Math.PI) / 3;
    ctx.beginPath();
    ctx.moveTo(gx + Math.cos(a) * r * 0.42, gy + Math.sin(a) * r * 0.42);
    ctx.lineTo(gx + Math.cos(a) * r * 0.7, gy + Math.sin(a) * r * 0.7);
    ctx.stroke();
  }
  if (gen.done) {
    drawSpark(cx + r * 0.7, cy - r * 0.7, 4, '#ffffff');
  }
  ctx.restore();
  // İlerleme çubuğu (üstte)
  const ratio = gen.progress / GENERATOR_REQUIRED_PROGRESS;
  ctx.fillStyle = INK;
  rr(ctx, px + 2, py - 3, TILE - 4, 4, 2);
  ctx.fill();
  ctx.fillStyle = gen.done ? PAL.genDone : '#ffffff';
  rr(ctx, px + 2.5, py - 2.5, Math.max(0, (TILE - 5) * ratio), 3, 1.5);
  ctx.fill();
}

function drawFog(t: number): void {
  fctx.globalCompositeOperation = 'source-over';
  fctx.clearRect(0, 0, W, H);
  fctx.fillStyle = 'rgba(22,10,48,.84)';
  fctx.fillRect(0, 0, W, H);
  fctx.globalCompositeOperation = 'destination-out';
  for (const p of Object.values(world.players)) {
    if (p.caught || p.x < 0) continue;
    const { cx, cy } = center(p);
    const radius = (visionRadius(world, p) + 0.6) * TILE;
    const g = fctx.createRadialGradient(cx, cy, radius * 0.45, cx, cy, radius);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.75, 'rgba(0,0,0,0.9)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    fctx.fillStyle = g;
    fctx.beginPath();
    fctx.arc(cx, cy, radius, 0, Math.PI * 2);
    fctx.fill();
  }
  fctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(fogCanvas, 0, 0);
  // Sıcak ışık halkaları
  ctx.globalCompositeOperation = 'lighter';
  for (const p of Object.values(world.players)) {
    if (p.caught || p.x < 0) continue;
    const { cx, cy } = center(p);
    const flicker = 0.92 + Math.sin(t * 9 + hash(p.key)) * 0.05;
    const radius = visionRadius(world, p) * TILE * 0.55 * flicker;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    g.addColorStop(0, 'rgba(255,190,110,.32)');
    g.addColorStop(1, 'rgba(255,190,110,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

function drawLabels(): void {
  ctx.font = '800 11px "Trebuchet MS", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const p of Object.values(world.players)) {
    if (p.x < 0) continue;
    const { cx, cy } = center(p);
    const label = p.caught ? `${p.name} · yakalandı` : p.name;
    const w = ctx.measureText(label).width + 12;
    const y = cy - TILE * 0.95;
    ctx.fillStyle = 'rgba(26,15,51,.78)';
    rr(ctx, cx - w / 2, y - 8, w, 16, 8);
    ctx.fill();
    ctx.fillStyle = p.role === 'killer' ? '#ffb3c6' : '#fff8ec';
    ctx.fillText(label, cx, y);
  }
  ctx.textBaseline = 'alphabetic';
}

function drawParticles(dt: number): void {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life += dt;
    if (p.life >= p.max) {
      particles.splice(i, 1);
      continue;
    }
    p.vy += p.g * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const k = 1 - p.life / p.max;
    ctx.globalAlpha = Math.max(0, k);
    if (p.kind === 'star') drawSpark(p.x, p.y, p.size * (0.6 + k * 0.6), p.color);
    else if (p.kind === 'heart') {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x - p.size * 0.5, p.y, p.size * 0.6, 0, Math.PI * 2);
      ctx.arc(p.x + p.size * 0.5, p.y, p.size * 0.6, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function drawRain(t: number): void {
  if (t > rainUntil.t) return;
  const colors = [PAL.sun, PAL.pink, PAL.mint, PAL.sky, PAL.violet];
  for (let i = 0; i < 4; i++) {
    spawn(Math.random() * W, -10, colors[i % colors.length], 1, 'dot', 20, 240);
  }
}

function drawMap(t: number, dt: number): void {
  if (staticFor !== world.map) buildStatic();
  ctx.drawImage(staticCanvas, 0, 0);

  // Hareket yönü takibi
  const now = elapsed;
  for (const p of Object.values(world.players)) {
    if (p.x < 0) continue;
    const prev = trail.get(p.key);
    if (!prev) {
      trail.set(p.key, { x: p.x, y: p.y, dx: 0, dy: 1, moved: 0 });
      continue;
    }
    if (prev.x !== p.x || prev.y !== p.y) {
      prev.dx = Math.sign(p.x - prev.x);
      prev.dy = Math.sign(p.y - prev.y);
      prev.x = p.x;
      prev.y = p.y;
      prev.moved = now;
    }
  }

  // Jeneratörler (zeminde)
  for (const g of world.generators) drawGenerator(g, t);

  // Karakterler, derinliğe göre sıralı
  const actors = Object.values(world.players)
    .filter((p) => p.x >= 0)
    .sort((a, b) => a.y - b.y);
  for (const p of actors) {
    const { cx, cy } = center(p);
    const tr = trail.get(p.key);
    const moving = tr !== undefined && now - tr.moved < 0.25;
    const dx = tr?.dx ?? 0;
    const dy = tr?.dy ?? 1;
    if (p.role === 'killer') drawKiller(p, cx, cy, t, dx, dy, moving);
    else drawSurvivor(p, cx, cy, t, dx, dy, moving);
  }

  if (world.phase === 'playing' && isDark(world)) drawFog(t);
  drawParticles(dt);
  drawRain(t);
  drawLabels();
}

// ---- HUD -----------------------------------------------------------------

function fmt(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function renderHud(): void {
  const remaining = Math.max(0, Math.ceil((MATCH_TICKS - world.tick) / TICK_RATE));
  $('timer').textContent = world.phase === 'playing' ? fmt(remaining) : world.phase === 'lobby' ? '05:00' : '—';
  const players = Object.values(world.players);
  $('count').textContent = `${players.length}/20`;
  const phaseEl = $('phase');
  const dark = world.phase === 'playing' && isDark(world);
  phaseEl.textContent = world.phase === 'lobby' ? 'LOBİ' : world.phase === 'ended' ? 'BİTTİ' : dark ? 'GECE' : 'GÜNDÜZ';
  phaseEl.className = `chip ${dark ? 'night' : world.phase === 'playing' ? 'day' : ''}`;

  const top = players.slice().sort((a, b) => b.score - a.score).slice(0, 3);
  $('ranks').innerHTML = top.length
    ? top.map((p, i) => `<div class="rank"><b>${i + 1}</b>${esc(p.name)} <em>${p.score}</em></div>`).join('')
    : '<div class="rank"><em>Henüz kimse yok · "GİR" yazın</em></div>';

  const done = world.generators.filter((g) => g.done).length;
  const total = world.generators.length;
  const progress = world.generators.reduce((s, g) => s + g.progress, 0) / (total * GENERATOR_REQUIRED_PROGRESS);
  $('gen-bar').style.width = `${Math.round(progress * 100)}%`;
  $('obj-num').textContent = `${done} / ${total}`;
  let objective = 'Yorum olarak GİR yazın';
  if (world.phase === 'lobby') objective = `Lobi açık · ${players.length < 2 ? 'en az 2 kişi gerekli' : 'başlatmaya hazır'}`;
  else if (world.phase === 'playing') objective = 'Jeneratörleri çalıştırın, katilden kaçın';
  else if (world.winReason) objective = world.winner === null ? 'Maç durduruldu' : REASON[world.winReason] ?? '';
  $('obj-text').textContent = objective;

  $('stats').innerHTML = `Faz: ${world.phase === 'lobby' ? 'Lobi' : world.phase === 'playing' ? 'Oyunda' : 'Bitti'}<br>Zorluk: ${DIFFICULTY_LABELS[world.difficulty]}<br>Oyuncu: ${players.length}/20 · Jeneratör: ${done}/${total}`;
}

// ---- Döngü ---------------------------------------------------------------

function frame(now: number): void {
  const frameMs = Math.min(now - last, 100);
  acc = Math.min(acc + frameMs, TICK_MS * 5);
  last = now;
  elapsed = now / 1000;
  while (acc >= TICK_MS) {
    acc -= TICK_MS;
    step(world);
    for (const e of world.events) handleEvent(e);
  }
  drawMap(elapsed, frameMs / 1000);
  renderHud();
  requestAnimationFrame(frame);
}

// ---- Etkileşim -----------------------------------------------------------

const giftsEl = $('gifts');
giftsEl.innerHTML = GIFTS.map(
  (g) => `<button class="gift ${g.tier}" data-gift="${g.name}"><span class="ico">${g.icon}</span><span class="nm">${g.name}</span><span class="tx">${esc(g.text)}</span></button>`,
).join('');
giftsEl.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-gift]');
  const card = GIFTS.find((g) => g.name === btn?.dataset.gift);
  if (card) sendGift(card);
});
document.querySelectorAll<HTMLButtonElement>('button[data-cmd]').forEach((b) =>
  b.addEventListener('click', () => chat(currentUser(), b.dataset.cmd ?? '')),
);

$('gear').addEventListener('click', () => $('sheet').classList.add('open'));
$('close').addEventListener('click', () => $('sheet').classList.remove('open'));
$('bots').addEventListener('click', () => {
  for (let i = 0; i < 5; i++) {
    botCounter += 1;
    chat(`bot${String(botCounter).padStart(2, '0')}`, 'GİR');
  }
});
$('start').addEventListener('click', () => {
  const r = startMatch(world);
  if (r.ok) {
    big('MAÇ BAŞLADI!', '', '#ffd23f', 1200);
    feed('Maç başladı', 'good');
    $('sheet').classList.remove('open');
  } else {
    feed(r.reason === 'not_enough_players' ? 'En az 2 oyuncu gerekli' : 'Maç zaten başladı', 'hot');
  }
});
$('stop').addEventListener('click', () => {
  if (stopMatch(world)) $('sheet').classList.remove('open');
});
$('reset').addEventListener('click', () => {
  world = createWorld(Date.now() & 0x7fffffff);
  botCounter = 0;
  trail.clear();
  particles.length = 0;
  $('feed').innerHTML = '';
  $('sheet').classList.remove('open');
  feed('Yeni lobi açıldı');
});
$sel('difficulty').addEventListener('change', (e) => {
  const d = (e.target as HTMLSelectElement).value as Difficulty;
  if (!setDifficulty(world, d)) feed('Zorluk yalnızca lobide değiştirilebilir', 'hot');
});

feed('Yayına başlamak için yorumda GİR yazın');
requestAnimationFrame((t) => {
  last = t;
  frame(t);
});
