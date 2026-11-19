import {
  DIFFICULTY_LABELS,
  GENERATOR_REQUIRED_PROGRESS,
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
  type Difficulty,
  type GameEvent,
  type GameWorld,
  type GiftEffect,
  type GiftTier,
} from '@ttl/game-core';

const TILE = 11;
const COLORS = {
  floor: '#0f131b', floorAlt: '#121721', wall: '#2a2f3c', wallEdge: '#3b4256',
  gen: '#ffb020', genDone: '#2ee6a6', killer: '#ff3d6e', survivor: '#36d1ff', caught: '#5b6172', protect: '#2ee6a6',
};

interface GiftCard { name: string; icon: string; tier: GiftTier; label: string; text: string }
const GIFTS: GiftCard[] = [
  { name: 'Gül', icon: '🌹', tier: 'small', label: 'HIZ', text: 'Hız bonusu' },
  { name: 'Kalp', icon: '💜', tier: 'medium', label: 'KALKAN', text: 'Yakalanmayı engeller' },
  { name: 'Aslan', icon: '🦁', tier: 'big', label: 'KATİL GÜÇLENDİ', text: 'Katil hızlanır' },
  { name: 'Evren', icon: '🌌', tier: 'special', label: 'HARİTA OLAYI', text: 'Karartma veya sıçrama' },
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

const canvas = document.getElementById('map') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const $ = (id: string): HTMLElement => document.getElementById(id)!;
const $in = (id: string): HTMLInputElement => document.getElementById(id) as HTMLInputElement;
const $sel = (id: string): HTMLSelectElement => document.getElementById(id) as HTMLSelectElement;

let world: GameWorld = createWorld(Date.now() & 0x7fffffff);
let botCounter = 0;
let acc = 0;
let last = performance.now();
let bigTimer: number | undefined;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
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
    case 'joined':
      feed(`${nameOf(e.key)} oyuna katıldı`, 'good');
      break;
    case 'task-progress':
      feed(`${nameOf(e.by)} jeneratöre çalıştı (%${e.progress})`);
      break;
    case 'generator-done':
      feed(`${nameOf(e.by)} bir jeneratörü tamamladı`, 'good');
      big('JENERATÖR TAMAM', `${world.generators.filter((g) => g.done).length} / ${world.generators.length}`, '#2ee6a6', 1200);
      break;
    case 'caught':
      feed(`${nameOf(e.by)}, ${nameOf(e.victim)} oyuncusunu yakaladı`, 'hot');
      big('YAKALANDI', nameOf(e.victim), '#ff3d6e', 1300);
      break;
    case 'rescued':
      feed(`${nameOf(e.by)}, ${nameOf(e.victim)} oyuncusunu kurtardı`, 'good');
      big('KURTARILDI', nameOf(e.victim), '#2ee6a6', 1300);
      break;
    case 'shield-blocked':
      feed(`${nameOf(e.victim)} kalkanla korundu`, 'gift');
      big('KALKAN!', nameOf(e.victim), '#a78bfa', 1200);
      break;
    case 'gift-effect':
      feed(`${nameOf(e.by)} hediye etkisi: ${EFFECT_LABEL[e.effect]}`, 'gift');
      big(EFFECT_LABEL[e.effect], nameOf(e.by), '#ffb020', 1500);
      break;
    case 'gift-ignored':
      feed(`${nameOf(e.by)} hediyesi bu maçta etki yaratmadı`);
      break;
    case 'ended':
      if (e.winner === null) big('MAÇ DURDU', REASON[e.reason] ?? '', '#ffffff', 2400);
      else big(e.winner === 'survivors' ? 'HAYATTA KALANLAR KAZANDI' : 'KATİL KAZANDI', REASON[e.reason] ?? '', e.winner === 'survivors' ? '#2ee6a6' : '#ff3d6e', 2600);
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
  feed(`${user} 🎁 ${card.name} gönderdi`, 'gift');
  enqueue(world, user, { type: 'gift', tier: card.tier, giftName: card.name });
}

// ---- Çizim ---------------------------------------------------------------

function drawMap(): void {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const { width, height, tiles } = world.map;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = x * TILE;
      const py = y * TILE;
      if (tiles[y * width + x] === TILE_WALL) {
        ctx.fillStyle = COLORS.wall;
        ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = COLORS.wallEdge;
        ctx.fillRect(px, py, TILE, 1);
      } else {
        ctx.fillStyle = (x + y) % 2 === 0 ? COLORS.floor : COLORS.floorAlt;
        ctx.fillRect(px, py, TILE, TILE);
      }
    }
  }
  for (const g of world.generators) {
    const px = g.x * TILE;
    const py = g.y * TILE;
    ctx.fillStyle = g.done ? COLORS.genDone : COLORS.gen;
    ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    ctx.fillRect(px + 2, py + TILE - 3, TILE - 4, 2);
    ctx.fillStyle = '#fff';
    ctx.fillRect(px + 2, py + TILE - 3, (TILE - 4) * (g.progress / GENERATOR_REQUIRED_PROGRESS), 2);
  }
  if (world.phase === 'playing' && isDark(world)) {
    const lit = litTiles(world);
    ctx.fillStyle = 'rgba(0,0,0,.88)';
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!lit[y * width + x]) ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
    }
  }
  ctx.textAlign = 'center';
  ctx.font = 'bold 8px system-ui, sans-serif';
  for (const p of Object.values(world.players)) {
    if (p.x < 0) continue;
    const cx = p.x * TILE + TILE / 2;
    const cy = p.y * TILE + TILE / 2;
    if (p.immunity > 0) {
      ctx.strokeStyle = COLORS.protect;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, TILE * 0.62, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = p.caught ? COLORS.caught : p.role === 'killer' ? COLORS.killer : COLORS.survivor;
    ctx.beginPath();
    ctx.arc(cx, cy, TILE * 0.36, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.role === 'killer' ? '#ff9ab3' : '#eef6ff';
    ctx.fillText(p.name, cx, cy - TILE * 0.6);
  }
}

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
    : '<div class="rank"><em>Henüz kimse yok — "GİR" yazın</em></div>';

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
  acc = Math.min(acc + (now - last), TICK_MS * 5);
  last = now;
  while (acc >= TICK_MS) {
    acc -= TICK_MS;
    step(world);
    for (const e of world.events) handleEvent(e);
  }
  drawMap();
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
    big('MAÇ BAŞLADI', '', '#2ee6a6', 1200);
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
