import {
  DIFFICULTY_LABELS,
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
  type GiftTier,
} from '@ttl/game-core';

const TILE = 28;
const HUD_H = 40;
const GIFTS: Array<{ name: string; tier: GiftTier; label: string }> = [
  { name: 'Gül', tier: 'small', label: 'Gül · hız bonusu' },
  { name: 'Kalp', tier: 'medium', label: 'Kalp · kalkan' },
  { name: 'Aslan', tier: 'big', label: 'Aslan · katili güçlendirir' },
  { name: 'Evren', tier: 'special', label: 'Evren · harita olayı' },
];
const REASON: Record<string, string> = {
  'generators-done': 'Tüm jeneratörler çalıştırıldı',
  'all-caught': 'Tüm hayatta kalanlar yakalandı',
  timeout: 'Süre doldu',
  'host-stopped': 'Maç durduruldu',
};

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const $ = (id: string): HTMLElement => document.getElementById(id)!;
const $in = (id: string): HTMLInputElement => document.getElementById(id) as HTMLInputElement;
const $sel = (id: string): HTMLSelectElement => document.getElementById(id) as HTMLSelectElement;

let world: GameWorld = createWorld(Date.now() & 0x7fffffff);
let botCounter = 0;
const log: string[] = [];
let acc = 0;
let last = performance.now();

function addLog(line: string): void {
  log.push(line);
  if (log.length > 60) log.splice(0, log.length - 60);
  const el = $('log');
  el.innerHTML = log.slice(-30).map((l) => `<li>${escape(l)}</li>`).join('');
  el.scrollTop = el.scrollHeight;
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

function describe(e: GameEvent): string {
  const name = (k: string) => world.players[k]?.name ?? k;
  switch (e.type) {
    case 'joined': return `${name(e.key)} lobiye katıldı`;
    case 'task-progress': return `${name(e.by)} jeneratör #${e.generatorId + 1} üzerinde çalıştı (%${e.progress})`;
    case 'generator-done': return `${name(e.by)} jeneratör #${e.generatorId + 1} tamamladı`;
    case 'caught': return `${name(e.by)}, ${name(e.victim)} oyuncusunu yakaladı`;
    case 'rescued': return `${name(e.by)}, ${name(e.victim)} oyuncusunu kurtardı`;
    case 'shield-blocked': return `${name(e.victim)} kalkanıyla yakalanmaktan kurtuldu`;
    case 'gift-effect': return `${name(e.by)} hediye etkisi: ${e.effect}`;
    case 'gift-ignored': return `${name(e.by)} hediyesi bu oyunda etki yaratmadı`;
    case 'ended': return e.winner === null ? 'Maç durduruldu' : `Kazanan: ${e.winner === 'survivors' ? 'Hayatta kalanlar' : 'Katil'}`;
  }
}

/** Yorum benzeri girişler: komut ayrıştırılır ve sıraya alınır. */
function chat(user: string, text: string): void {
  const command = parseCommand(text);
  if (!command) {
    addLog(`${user}: ${text} (tanınmayan komut)`);
    return;
  }
  addLog(`${user}: ${text}`);
  enqueue(world, user, command);
}

function sendGift(user: string, giftName: string): void {
  const g = GIFTS.find((x) => x.name === giftName);
  if (!g) return;
  addLog(`${user} hediye gönderdi: ${g.name}`);
  enqueue(world, user, { type: 'gift', tier: g.tier, giftName: g.name });
}

function currentUser(): string {
  return $in('user').value.trim() || 'Ayşe';
}

// ---- Çizim ---------------------------------------------------------------

function draw(): void {
  ctx.fillStyle = '#05070b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const { width, height, tiles } = world.map;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = x * TILE;
      const py = HUD_H + y * TILE;
      if (tiles[y * width + x] === TILE_WALL) {
        ctx.fillStyle = '#27303d';
        ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = '#3a4658';
        ctx.fillRect(px, py, TILE, 2);
      } else {
        ctx.fillStyle = (x + y) % 2 === 0 ? '#0d1219' : '#101720';
        ctx.fillRect(px, py, TILE, TILE);
      }
    }
  }
  for (const g of world.generators) {
    const px = g.x * TILE;
    const py = HUD_H + g.y * TILE;
    ctx.fillStyle = g.done ? '#3ddc84' : '#f5c542';
    ctx.fillRect(px + 4, py + 4, TILE - 8, TILE - 8);
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    ctx.fillRect(px + 4, py + TILE - 8, TILE - 8, 4);
    ctx.fillStyle = '#fff';
    ctx.fillRect(px + 4, py + TILE - 8, (TILE - 8) * (g.progress / 100), 4);
  }
  if (world.phase === 'playing' && isDark(world)) {
    const lit = litTiles(world);
    ctx.fillStyle = 'rgba(0,0,0,.86)';
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!lit[y * width + x]) ctx.fillRect(x * TILE, HUD_H + y * TILE, TILE, TILE);
      }
    }
  }
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (const p of Object.values(world.players)) {
    if (p.x < 0) continue;
    const cx = p.x * TILE + TILE / 2;
    const cy = HUD_H + p.y * TILE + TILE / 2;
    if (p.immunity > 0) {
      ctx.strokeStyle = '#9be7a5';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, TILE * 0.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = p.caught ? '#5f6672' : p.role === 'killer' ? '#ff4d4d' : '#4fc3f7';
    ctx.beginPath();
    ctx.arc(cx, cy, TILE * 0.34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.role === 'killer' ? '#ff9a9a' : '#e6f7ff';
    ctx.fillText(p.caught ? `${p.name} (yakalandı)` : p.name, cx, cy - TILE * 0.42);
  }
  // HUD
  ctx.fillStyle = '#d8dee9';
  ctx.font = '15px system-ui, sans-serif';
  ctx.textAlign = 'left';
  const phase = world.phase === 'lobby' ? 'LOBİ' : world.phase === 'ended' ? 'BİTTİ' : isDark(world) ? 'GECE' : 'GÜNDÜZ';
  const remaining = Math.max(0, Math.ceil((MATCH_TICKS - world.tick) / TICK_RATE));
  const timer = world.phase === 'playing' ? `Kalan ${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}` : '';
  const done = world.generators.filter((g) => g.done).length;
  ctx.fillText(`${phase}   Oyuncu ${Object.keys(world.players).length}/20   Jeneratör ${done}/${world.generators.length}   ${timer}`, 12, 26);
  if (world.phase === 'lobby') {
    const names = Object.values(world.players).map((p) => p.name).slice(0, 12).join(', ');
    banner(names ? `Lobi: ${names}` : 'Lobi boş. Yorum olarak GİR yazın.', 'Başlatmak için "Maçı başlat" (en az 2 oyuncu)');
  } else if (world.phase === 'ended' && world.winReason) {
    const head = world.winner === null ? 'MAÇ DURDURULDU' : `KAZANAN: ${world.winner === 'survivors' ? 'HAYATTA KALANLAR' : 'KATİL'}`;
    banner(head, REASON[world.winReason] ?? '');
  }
}

function banner(a: string, b: string): void {
  ctx.fillStyle = 'rgba(0,0,0,.72)';
  ctx.fillRect(canvas.width / 2 - 260, canvas.height / 2 - 40, 520, 80);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.font = 'bold 20px system-ui, sans-serif';
  ctx.fillText(a, canvas.width / 2, canvas.height / 2 - 8);
  ctx.font = '14px system-ui, sans-serif';
  ctx.fillText(b, canvas.width / 2, canvas.height / 2 + 18);
}

function renderPanel(): void {
  $('s-phase').textContent = world.phase === 'lobby' ? 'Lobi' : world.phase === 'playing' ? 'Oyunda' : 'Bitti';
  $('s-players').textContent = `${Object.keys(world.players).length} / 20`;
  $('s-gens').textContent = `${world.generators.filter((g) => g.done).length} / ${world.generators.length}`;
  const remaining = Math.max(0, Math.ceil((MATCH_TICKS - world.tick) / TICK_RATE));
  $('s-time').textContent = world.phase === 'playing' ? `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}` : '-';
  $('s-winner').textContent = world.winReason ? (world.winner === null ? 'Durduruldu' : world.winner === 'survivors' ? 'Hayatta kalanlar' : 'Katil') + ` · ${REASON[world.winReason]}` : '-';
  $sel('difficulty').disabled = world.phase !== 'lobby';
  const rows = Object.values(world.players)
    .slice()
    .sort((a, b) => b.score - a.score)
    .map((p) => {
      const state = !p.connected ? 'Bağlantı yok' : p.caught ? 'Yakalandı' : world.phase === 'lobby' ? 'Lobide' : 'Aktif';
      return `<tr><td>${escape(p.name)}</td><td>${p.role === 'killer' ? 'Katil' : 'Hayatta'}</td><td>${state}</td><td class="num">${p.score}</td></tr>`;
    })
    .join('');
  $('players').innerHTML = rows || '<tr><td colspan="4" style="color:var(--muted)">Henüz oyuncu yok</td></tr>';
}

// ---- Döngü ---------------------------------------------------------------

function frame(now: number): void {
  acc = Math.min(acc + (now - last), TICK_MS * 5);
  last = now;
  while (acc >= TICK_MS) {
    acc -= TICK_MS;
    step(world);
    for (const e of world.events) addLog(describe(e));
  }
  draw();
  requestAnimationFrame(frame);
}

// ---- Olay bağlantıları ----------------------------------------------------

$('send').addEventListener('click', () => {
  const input = $in('text');
  if (!input.value.trim()) return;
  chat(currentUser(), input.value.trim());
  input.value = '';
});
$in('text').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('send').click();
});
document.querySelectorAll<HTMLButtonElement>('button[data-cmd]').forEach((b) =>
  b.addEventListener('click', () => chat(currentUser(), b.dataset.cmd ?? '')),
);
$('bots').addEventListener('click', () => {
  for (let i = 0; i < 5; i++) {
    botCounter += 1;
    chat(`bot${String(botCounter).padStart(2, '0')}`, 'GİR');
  }
});
$('start').addEventListener('click', () => {
  const r = startMatch(world);
  addLog(r.ok ? 'Maç başladı' : r.reason === 'not_enough_players' ? 'En az 2 oyuncu gerekli' : 'Maç zaten başladı');
});
$('stop').addEventListener('click', () => {
  if (stopMatch(world)) addLog('Maç durduruldu');
});
$('reset').addEventListener('click', () => {
  world = createWorld(Date.now() & 0x7fffffff);
  botCounter = 0;
  log.length = 0;
  $('log').innerHTML = '';
  addLog('Yeni lobi oluşturuldu');
});
$sel('difficulty').addEventListener('change', (e) => {
  const d = (e.target as HTMLSelectElement).value as Difficulty;
  if (setDifficulty(world, d)) addLog(`Zorluk: ${DIFFICULTY_LABELS[d]}`);
});
$sel('gift').innerHTML = GIFTS.map((g) => `<option value="${g.name}">${g.label}</option>`).join('');
$('gift-send').addEventListener('click', () => sendGift(currentUser(), $sel('gift').value));

// Klavye: ok tuşları ve boşluk, seçili kullanıcı adıyla
const KEYS: Record<string, string> = { ArrowUp: 'YUKARI', ArrowDown: 'AŞAĞI', ArrowLeft: 'SOL', ArrowRight: 'SAĞ', ' ': 'GÖREV' };
window.addEventListener('keydown', (e) => {
  if (document.activeElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
  const text = KEYS[e.key];
  if (!text) return;
  e.preventDefault();
  chat(currentUser(), text);
});

addLog('Prototip hazır. Bot ekleyip maçı başlatın.');
requestAnimationFrame((t) => {
  last = t;
  frame(t);
});
renderPanel();
setInterval(renderPanel, 250);
