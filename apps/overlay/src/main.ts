import Phaser from 'phaser';
import { GIFT_TIER_LABELS, parseCommand, type GameWorld, type GiftTier } from '@ttl/game-core';
import { REASON_LABEL, pushLog } from './format';
import { CANVAS_H, CANVAS_W, GameScene } from './scenes/GameScene';
import { createSession } from './session';
import { RoomClient } from './net/RoomClient';

const SERVER_URL: string = import.meta.env.VITE_SERVER_URL ?? 'http://127.0.0.1:3000';
const HOST_TOKEN: string = import.meta.env.VITE_HOST_TOKEN ?? 'dev-host-token';

const session = createSession();
const room = new RoomClient(SERVER_URL, HOST_TOKEN, session);
let botCounter = 0;

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'stage',
  width: CANVAS_W,
  height: CANVAS_H,
  backgroundColor: '#05070b',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [new GameScene(session)],
});

// ---- Yayıncı/test paneli -------------------------------------------------

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Eleman bulunamadı: #${id}`);
  return el as T;
};

const userInput = $<HTMLInputElement>('user');
const textInput = $<HTMLInputElement>('text');

function currentUser(): string {
  return userInput.value.trim() || 'Ayşe';
}

/** Simülatör yorumu: sunucuya gider, çözümleme ve hız sınırı sunucuda yapılır. */
function sendChat(user: string, text: string): void {
  if (parseCommand(text) === null) pushLog(session.log, `${user}: ${text} (tanınmayan komut)`);
  else pushLog(session.log, `${user}: ${text}`);
  room.hostChat(user, text);
}

$('send').addEventListener('click', () => {
  const text = textInput.value.trim();
  if (!text) return;
  sendChat(currentUser(), text);
  textInput.value = '';
  textInput.focus();
});
textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $<HTMLButtonElement>('send').click();
});

document.querySelectorAll<HTMLButtonElement>('button[data-cmd]').forEach((btn) => {
  btn.addEventListener('click', () => sendChat(currentUser(), btn.dataset.cmd ?? ''));
});

$('bots').addEventListener('click', () => {
  for (let i = 0; i < 5; i++) {
    botCounter += 1;
    sendChat(`bot${String(botCounter).padStart(2, '0')}`, 'GİR');
  }
});

$('start').addEventListener('click', () => room.hostStart());
$('reset').addEventListener('click', () => {
  botCounter = 0;
  room.hostReset();
});

// ---- Hediyeler -----------------------------------------------------------

$('gift-send-btn').addEventListener('click', () => {
  const name = $<HTMLSelectElement>('gift-send').value;
  if (!name) return;
  const user = currentUser();
  pushLog(session.log, `${user} hediye gönderdi: ${name}`);
  room.sendGift(user, name);
});

$('gift-save').addEventListener('click', () => {
  const name = $<HTMLInputElement>('gift-name').value.trim();
  if (!name) {
    pushLog(session.log, '» Hediye adı boş olamaz');
    return;
  }
  room.setGift(name, $<HTMLSelectElement>('gift-tier').value as GiftTier);
  $<HTMLInputElement>('gift-name').value = '';
});

$('gift-rows').addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const del = target.closest<HTMLButtonElement>('button[data-del]');
  if (del?.dataset.del) {
    room.deleteGift(del.dataset.del);
    return;
  }
  const edit = target.closest<HTMLButtonElement>('button[data-edit]');
  if (edit?.dataset.edit) {
    $<HTMLInputElement>('gift-name').value = edit.dataset.edit;
    $<HTMLSelectElement>('gift-tier').value = edit.dataset.tier ?? 'small';
  }
});

let lastGiftSignature = '';
function renderGifts(): void {
  const signature = JSON.stringify(session.gifts);
  if (signature === lastGiftSignature) return;
  lastGiftSignature = signature;

  $('gift-rows').innerHTML =
    session.gifts
      .map(
        (g) =>
          `<tr><td>${escapeHtml(g.name)}</td><td>${GIFT_TIER_LABELS[g.tier]}</td><td class="num"><button data-edit="${escapeHtml(g.name)}" data-tier="${g.tier}">Düzenle</button> <button class="danger" data-del="${escapeHtml(g.name)}">Sil</button></td></tr>`,
      )
      .join('') || '<tr><td colspan="3" class="muted">Eşleme yok</td></tr>';

  const select = $<HTMLSelectElement>('gift-send');
  const current = select.value;
  select.innerHTML =
    session.gifts
      .map((g) => `<option value="${escapeHtml(g.name)}">${escapeHtml(g.name)} (${GIFT_TIER_LABELS[g.tier]})</option>`)
      .join('') || '<option value="">Eşleme yok</option>';
  if (session.gifts.some((g) => g.name === current)) select.value = current;
}

function renderPanel(world: GameWorld | null): void {
  if (!world) {
    $('stat-phase').textContent = session.connected ? 'Bekleniyor' : 'Bağlanıyor';
    $('players').innerHTML = '<tr><td colspan="4" class="muted">Sunucu verisi bekleniyor</td></tr>';
  } else {
    renderWorldPanel(world);
  }
  $('conn').textContent = session.connected ? 'Sunucu bağlı' : 'Sunucu bağlantısı yok';
  $('src').textContent = sourceLabel(session.source);
  $('conn').className = session.connected ? 'ok' : 'bad';
  renderGifts();

  const logEl = $('log');
  if (logEl.dataset.count !== String(session.log.length)) {
    logEl.innerHTML = session.log.slice(-30).map((l) => `<li>${escapeHtml(l)}</li>`).join('');
    logEl.dataset.count = String(session.log.length);
    logEl.scrollTop = logEl.scrollHeight;
  }
}

const SOURCE_TEXT: Record<string, string> = {
  disabled: 'TikTok kapalı',
  idle: 'TikTok beklemede',
  connecting: 'TikTok bağlanıyor',
  connected: 'TikTok yayında',
  offline: 'TikTok yayını kapalı',
  error: 'TikTok hatası',
};

function sourceLabel(info: { status: string; detail?: string } | null): string {
  if (!info) return '';
  return SOURCE_TEXT[info.status] ?? info.status;
}

function renderWorldPanel(world: GameWorld): void {
  const players = Object.values(world.players);
  const survivors = players.filter((p) => p.role === 'survivor');
  const caught = survivors.filter((p) => p.caught).length;
  const done = world.generators.filter((g) => g.done).length;

  $('stat-phase').textContent =
    world.phase === 'lobby' ? 'Lobi' : world.phase === 'playing' ? 'Oyunda' : 'Bitti';
  $('stat-players').textContent = `${players.length} / 20`;
  $('stat-gens').textContent = `${done} / ${world.generators.length}`;
  $('stat-caught').textContent = world.phase === 'playing' ? `${caught} / ${survivors.length}` : '-';
  $('stat-winner').textContent =
    world.winner === null
      ? '-'
      : `${world.winner === 'survivors' ? 'Hayatta kalanlar' : 'Katil'}: ${world.winReason ? REASON_LABEL[world.winReason] : ''}`;

  const rows = players
    .slice()
    .sort((a, b) => b.score - a.score)
    .map((p) => {
      const role = p.role === 'killer' ? 'Katil' : 'Hayatta';
      const state = !p.connected
        ? 'Bağlantı yok'
        : p.caught
          ? 'Yakalandı'
          : world.phase === 'lobby'
            ? 'Lobide'
            : 'Aktif';
      return `<tr><td>${escapeHtml(p.name)}</td><td>${role}</td><td>${state}</td><td class="num">${p.score}</td></tr>`;
    })
    .join('');
  $('players').innerHTML = rows || '<tr><td colspan="4" class="muted">Henüz oyuncu yok</td></tr>';
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

setInterval(() => renderPanel(session.world), 250);

