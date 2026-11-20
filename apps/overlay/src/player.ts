import { io, type Socket } from 'socket.io-client';
import type { AckResult, HelloResult, InitMessage, PublicState, StateMessage, EventsMessage } from '@ttl/game-core';
import { errorText } from './format';

/**
 * Test oyuncusu sayfası. Her oyuncu kendi telefonunda açar, adını yazar ve oynar.
 * Oyun durumunu sunucudan alır; hiçbir yayıncı yetkisi yoktur.
 */
const params = new URLSearchParams(window.location.search);
const SERVER_URL: string = params.get('server') ?? import.meta.env.VITE_SERVER_URL ?? window.location.origin;
const ROOM_ID = params.get('room');
const STORE_KEY = `ttl-player-${ROOM_ID ?? 'open'}`;

interface Saved { name: string; token: string; key: string }
let me: Saved | null = null;
let state: PublicState | null = null;
let stale = false;

const $ = (id: string): HTMLElement => document.getElementById(id)!;
const $in = (id: string): HTMLInputElement => document.getElementById(id) as HTMLInputElement;

function load(): Saved | null {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

function save(v: Saved | null): void {
  try {
    if (v) sessionStorage.setItem(STORE_KEY, JSON.stringify(v));
    else sessionStorage.removeItem(STORE_KEY);
  } catch {
    // Depolama kapalıysa oyuncu yalnızca bu sayfa açıkken kalır.
  }
}

function feedback(text: string): void {
  $('feedback').textContent = text;
}

const socket: Socket = io(SERVER_URL, {
  auth: ROOM_ID ? { room: ROOM_ID } : {},
  reconnectionDelayMax: 3000,
});

socket.on('connect', () => {
  $('conn').textContent = 'bağlı';
  rejoin();
});
socket.on('disconnect', () => {
  $('conn').textContent = 'bağlantı koptu, yeniden deneniyor';
});
socket.on('connect_error', (err: Error) => {
  if (err.message === 'room_mismatch') {
    stale = true;
    $('conn').textContent = 'bu bağlantı geçersiz';
    feedback('Bu oda bağlantısı eski. Yayıncıdan yeni bağlantıyı isteyin.');
    socket.disconnect();
  }
});
socket.on('init', (m: InitMessage) => {
  if (ROOM_ID && m.roomId !== ROOM_ID) {
    stale = true;
    feedback('Oda değişti. Yayıncıdan yeni bağlantıyı isteyin.');
    socket.disconnect();
    return;
  }
  state = m.state;
  render();
});
socket.on('state', (m: StateMessage) => {
  state = m.state;
  render();
});
socket.on('events', (m: EventsMessage) => {
  if (!me) return;
  for (const e of m.events) {
    if (e.type === 'caught' && e.victim === me.key) feedback('Yakalandın! Bir arkadaşın kurtarabilir.');
    else if (e.type === 'rescued' && e.victim === me.key) feedback('Kurtarıldın! Kısa bir süre korunuyorsun.');
    else if (e.type === 'shield-blocked' && e.victim === me.key) feedback('Kalkanın seni yakalamaktan korudu.');
    else if (e.type === 'ended') feedback(e.winner === null ? 'Maç durduruldu.' : e.winner === 'survivors' ? 'Hayatta kalanlar kazandı!' : 'Katil kazandı!');
  }
});

function applyHello(r: HelloResult, name: string): void {
  if (r.ok) {
    me = { name: r.name, token: r.token, key: r.key };
    save(me);
    feedback('');
  } else {
    if (r.reason === 'name_taken' || r.reason === 'invalid_name' || r.reason === 'blocked') {
      me = null;
      save(null);
    }
    feedback(errorText(r.reason));
  }
  if (!me) $in('name').value = name;
  render();
}

function rejoin(): void {
  if (stale) return;
  const saved = load();
  if (!saved) return;
  socket.emit('hello', { name: saved.name, token: saved.token }, (r: HelloResult) => applyHello(r, saved.name));
}

$('join').addEventListener('click', () => {
  const name = $in('name').value.trim();
  if (!name) {
    feedback('Bir ad yaz.');
    return;
  }
  socket.emit('hello', { name }, (r: HelloResult) => applyHello(r, name));
});
$in('name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('join').click();
});

function send(text: string): void {
  socket.emit('command', { text }, (r: AckResult) => {
    if (!r.ok) feedback(errorText(r.reason));
  });
}
document.querySelectorAll<HTMLButtonElement>('button[data-cmd]').forEach((b) =>
  b.addEventListener('click', () => send(b.dataset.cmd ?? '')),
);

$('leave').addEventListener('click', () => {
  me = null;
  save(null);
  feedback('');
  render();
});

function render(): void {
  $('join-card').classList.toggle('hidden', me !== null);
  $('game-card').classList.toggle('hidden', me === null);
  if (!me) return;
  const mine = state?.players[me.key];
  const phase = state?.phase ?? 'lobby';
  const role = $('role');
  if (!mine || phase === 'lobby') {
    role.textContent = 'Lobi';
    role.className = 'role none';
    $('status').textContent = mine ? `${me.name}, maç başlamayı bekliyorsun.` : 'Oyuna bağlanıyor…';
  } else if (phase === 'playing') {
    role.textContent = mine.role === 'killer' ? 'KATİL' : 'Hayatta kalan';
    role.className = `role ${mine.role}`;
    $('status').textContent = mine.caught
      ? 'Yakalandın. Arkadaşların seni kurtarabilir.'
      : mine.role === 'killer'
        ? 'Hayatta kalanları yakala. GÖREV yakındaki birini yakalar.'
        : 'Jeneratörlere çalış. GÖREV jeneratörün yanında çalıştırır.';
  } else {
    role.textContent = 'Maç bitti';
    role.className = 'role none';
    $('status').textContent = 'Yeni maç için yayıncıyı bekle.';
  }
  const active = phase === 'playing' && !mine?.caught;
  document.querySelectorAll<HTMLButtonElement>('button[data-cmd]').forEach((b) => {
    b.disabled = !active;
  });
}

render();
