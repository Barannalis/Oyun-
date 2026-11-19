import Phaser from 'phaser';
import {
  createWorld,
  enqueue,
  parseCommand,
  startMatch,
  type GameWorld,
} from '@ttl/game-core';
import { CANVAS_H, CANVAS_W, GameScene, type Session } from './scenes/GameScene';
import { SimulatedChatSource } from './sim/SimulatedChatSource';
import { REASON_LABEL, pushLog } from './format';

const session: Session = {
  world: createWorld(newSeed()),
  log: [],
};
const source = new SimulatedChatSource();
let botCounter = 0;

// Yorum akışı: kaynak → komut çözümleme → sıraya alma
source.subscribe((msg) => {
  pushLog(session.log, `${msg.user}: ${msg.text}`);
  const command = parseCommand(msg.text);
  if (command) enqueue(session.world, msg.user, command);
});

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

function sendAs(user: string, text: string): void {
  source.send(user, text);
}

function notify(line: string): void {
  pushLog(session.log, `» ${line}`);
}

$('send').addEventListener('click', () => {
  const text = textInput.value.trim();
  if (!text) return;
  sendAs(currentUser(), text);
  textInput.value = '';
  textInput.focus();
});
textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $<HTMLButtonElement>('send').click();
});

document.querySelectorAll<HTMLButtonElement>('button[data-cmd]').forEach((btn) => {
  btn.addEventListener('click', () => sendAs(currentUser(), btn.dataset.cmd ?? ''));
});

$('bots').addEventListener('click', () => {
  for (let i = 0; i < 5; i++) {
    botCounter += 1;
    sendAs(`bot${String(botCounter).padStart(2, '0')}`, 'GİR');
  }
});

$('start').addEventListener('click', () => {
  const result = startMatch(session.world);
  if (result.ok) notify('Maç başladı');
  else notify(result.reason);
});

$('reset').addEventListener('click', () => {
  session.world = createWorld(newSeed());
  session.log.length = 0;
  notify('Yeni lobi oluşturuldu');
});

function renderPanel(world: GameWorld): void {
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
      const state = p.caught ? 'Yakalandı' : world.phase === 'lobby' ? 'Lobide' : 'Aktif';
      return `<tr><td>${escapeHtml(p.name)}</td><td>${role}</td><td>${state}</td><td class="num">${p.score}</td></tr>`;
    })
    .join('');
  $('players').innerHTML = rows || '<tr><td colspan="4" class="muted">Henüz oyuncu yok</td></tr>';

  const logEl = $('log');
  const lines = session.log.slice(-30).map((l) => `<li>${escapeHtml(l)}</li>`).join('');
  if (logEl.dataset.count !== String(session.log.length)) {
    logEl.innerHTML = lines;
    logEl.dataset.count = String(session.log.length);
    logEl.scrollTop = logEl.scrollHeight;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

setInterval(() => renderPanel(session.world), 250);

function newSeed(): number {
  return Math.floor(Math.random() * 2_000_000_000);
}

source.start();
