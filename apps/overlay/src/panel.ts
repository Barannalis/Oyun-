import {
  DIFFICULTY_LABELS,
  GIFT_TIER_LABELS,
  MATCH_TICKS,
  TICK_RATE,
  parseCommand,
  type Difficulty,
  type GameWorld,
  type GiftTier,
} from '@ttl/game-core';
import { REASON_LABEL, pushLog } from './format';
import { createSession } from './session';
import { RoomClient } from './net/RoomClient';

const SERVER_URL: string = import.meta.env.VITE_SERVER_URL ?? 'http://127.0.0.1:3000';
const TOKEN_KEY = 'ttl-host-token';

/** Anahtar yalnızca oturumda saklanır. Geliştirmede isteğe bağlı olarak ortam değişkeninden gelir. */
function currentToken(): string | undefined {
  try {
    const stored = sessionStorage.getItem(TOKEN_KEY);
    if (stored) return stored;
  } catch {
    // Depolama kapalıysa anahtar yalnızca bu oturumda kullanılamaz.
  }
  return import.meta.env.DEV ? (import.meta.env.VITE_HOST_TOKEN as string | undefined) : undefined;
}

const session = createSession();
const room = new RoomClient(session, { url: SERVER_URL, getToken: currentToken });
let botCounter = 0;
let lastOverlayUrl = '';
let lastBlockedSig = '';
let lastGiftSig = '';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Eleman bulunamadı: #${id}`);
  return el as T;
};

function currentUser(): string {
  return $<HTMLInputElement>('user').value.trim() || 'Ayşe';
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

// ---- Giriş -----------------------------------------------------------------

$('login').addEventListener('click', () => {
  const input = $<HTMLInputElement>('token');
  const value = input.value.trim();
  if (!value) return;
  sessionStorage.setItem(TOKEN_KEY, value);
  input.value = '';
  session.authOk = null;
  room.refreshStatus();
  room.refreshGifts();
});

$('logout').addEventListener('click', () => {
  sessionStorage.removeItem(TOKEN_KEY);
  session.authOk = null;
  session.hostStatus = null;
});

// ---- Yayın bağlantısı -----------------------------------------------------

function overlayUrl(roomId: string): string {
  const url = new URL('overlay.html', window.location.href);
  url.searchParams.set('server', SERVER_URL);
  url.searchParams.set('room', roomId);
  return url.toString();
}

$('copy-url').addEventListener('click', async () => {
  const value = $<HTMLInputElement>('overlay-url').value;
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    pushLog(session.log, '» Yayın bağlantısı kopyalandı');
  } catch {
    $<HTMLInputElement>('overlay-url').select();
    pushLog(session.log, '» Kopyalanamadı, bağlantıyı elle seçip kopyalayın');
  }
});

$('open-url').addEventListener('click', () => {
  const value = $<HTMLInputElement>('overlay-url').value;
  if (value) window.open(value, '_blank', 'noopener');
});

// ---- Oyun kontrolü ---------------------------------------------------------

$('start').addEventListener('click', () => room.hostStart());
$('stop').addEventListener('click', () => room.hostStop());
$('reset').addEventListener('click', () => {
  if (!window.confirm('Yeni oda açılacak. Mevcut lobi silinir ve yayın bağlantısı değişir. Devam edilsin mi?')) return;
  botCounter = 0;
  room.hostReset();
});
$('difficulty').addEventListener('change', (e) => {
  room.hostDifficulty((e.target as HTMLSelectElement).value as Difficulty);
});

// ---- Oyuncu engelleme ------------------------------------------------------

$('players').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-block]');
  if (btn?.dataset.block) room.hostBlock(btn.dataset.block);
});

$('blocked').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-unblock]');
  if (btn?.dataset.unblock) room.hostUnblock(btn.dataset.unblock);
});

// ---- Yorum simülatörü ------------------------------------------------------

function sendChat(user: string, text: string): void {
  pushLog(session.log, parseCommand(text) === null ? `${user}: ${text} (tanınmayan komut)` : `${user}: ${text}`);
  room.hostChat(user, text);
}

$('send').addEventListener('click', () => {
  const input = $<HTMLInputElement>('text');
  const text = input.value.trim();
  if (!text) return;
  sendChat(currentUser(), text);
  input.value = '';
  input.focus();
});
$('text').addEventListener('keydown', (e) => {
  if ((e as KeyboardEvent).key === 'Enter') $<HTMLButtonElement>('send').click();
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

// ---- Hediyeler -------------------------------------------------------------

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

// ---- Çizim -----------------------------------------------------------------

function renderAuth(): void {
  const el = $('auth-status');
  const hasToken = Boolean(currentToken());
  if (session.authOk === true) {
    el.textContent = 'Yetki tamam. Oyun kontrolleri açık.';
    el.className = 'notice ok';
  } else if (session.authOk === false) {
    el.textContent = 'Anahtar hatalı. Doğru yayıncı anahtarını girin.';
    el.className = 'notice bad';
  } else if (!hasToken) {
    el.textContent = 'Anahtar girilmedi. Oyun kontrolleri için giriş yapın.';
    el.className = 'notice warn';
  } else {
    el.textContent = 'Yetki kontrol ediliyor…';
    el.className = 'notice warn';
  }
}

function renderLink(): void {
  const roomId = session.hostStatus?.roomId ?? '';
  const url = roomId ? overlayUrl(roomId) : '';
  if (url === lastOverlayUrl) return;
  lastOverlayUrl = url;
  $<HTMLInputElement>('overlay-url').value = url;
  const frame = $<HTMLIFrameElement>('preview');
  if (url) frame.src = url;
  else frame.removeAttribute('src');
}

function renderBlocked(): void {
  const blocked = session.hostStatus?.blocked ?? [];
  const sig = JSON.stringify(blocked);
  if (sig === lastBlockedSig) return;
  lastBlockedSig = sig;
  $('blocked').innerHTML = blocked.length
    ? blocked
        .map(
          (b) =>
            `<div class="row" style="justify-content:space-between;margin-bottom:6px"><span>${escapeHtml(b.name)}</span><button data-unblock="${escapeHtml(b.name)}">Engeli kaldır</button></div>`,
        )
        .join('')
    : '<span class="muted">Engelli oyuncu yok.</span>';
}

function renderGifts(): void {
  const sig = JSON.stringify(session.gifts);
  if (sig === lastGiftSig) return;
  lastGiftSig = sig;
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

function renderWorld(world: GameWorld | null): void {
  const hasAuth = session.authOk === true;
  for (const id of ['start', 'stop', 'reset', 'difficulty']) {
    $<HTMLButtonElement | HTMLSelectElement>(id).disabled = !hasAuth;
  }
  $<HTMLButtonElement>('stop').disabled = !hasAuth || world?.phase !== 'playing';

  if (session.hostStatus && document.activeElement !== $('difficulty')) {
    $<HTMLSelectElement>('difficulty').value = session.hostStatus.difficulty;
  }

  if (!world) {
    $('stat-phase').textContent = session.connected ? 'Bekleniyor' : 'Bağlanıyor';
    $('players').innerHTML = '<tr><td colspan="5" class="muted">Sunucu verisi bekleniyor</td></tr>';
    return;
  }

  const players = Object.values(world.players);
  const survivors = players.filter((p) => p.role === 'survivor');
  const caught = survivors.filter((p) => p.caught).length;
  const done = world.generators.filter((g) => g.done).length;
  const remaining = Math.max(0, Math.ceil((MATCH_TICKS - world.tick) / TICK_RATE));

  $('stat-phase').textContent = world.phase === 'lobby' ? 'Lobi' : world.phase === 'playing' ? 'Oyunda' : 'Bitti';
  $('stat-players').textContent = `${players.length} / 20`;
  $('stat-gens').textContent = `${done} / ${world.generators.length}`;
  $('stat-caught').textContent = world.phase === 'playing' ? `${caught} / ${survivors.length}` : '-';
  $('stat-time').textContent =
    world.phase === 'playing' ? `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}` : '-';
  $('stat-difficulty').textContent = DIFFICULTY_LABELS[world.difficulty];
  $('stat-winner').textContent =
    world.winReason === null
      ? '-'
      : world.winner === null
        ? `Durduruldu: ${REASON_LABEL[world.winReason]}`
        : `${world.winner === 'survivors' ? 'Hayatta kalanlar' : 'Katil'}: ${REASON_LABEL[world.winReason]}`;

  const rows = players
    .slice()
    .sort((a, b) => b.score - a.score)
    .map((p) => {
      const role = p.role === 'killer' ? 'Katil' : 'Hayatta';
      const state = !p.connected ? 'Bağlantı yok' : p.caught ? 'Yakalandı' : world.phase === 'lobby' ? 'Lobide' : 'Aktif';
      const action = `<button class="danger" data-block="${escapeHtml(p.name)}"${hasAuth ? '' : ' disabled'}>Engelle</button>`;
      return `<tr><td>${escapeHtml(p.name)}</td><td>${role}</td><td>${state}</td><td class="num">${p.score}</td><td class="num">${action}</td></tr>`;
    })
    .join('');
  $('players').innerHTML = rows || '<tr><td colspan="5" class="muted">Henüz oyuncu yok</td></tr>';
}

function renderLog(): void {
  const logEl = $('log');
  if (logEl.dataset.count !== String(session.log.length)) {
    logEl.innerHTML = session.log.slice(-30).map((l) => `<li>${escapeHtml(l)}</li>`).join('');
    logEl.dataset.count = String(session.log.length);
    logEl.scrollTop = logEl.scrollHeight;
  }
}

function render(): void {
  $('conn').textContent = session.connected ? 'Sunucu bağlı' : 'Sunucu bağlantısı yok';
  $('conn').className = session.connected ? 'ok' : 'bad';
  $('src').textContent = session.source ? sourceLabel(session.source.status) : '';
  renderAuth();
  renderLink();
  renderWorld(session.world);
  renderBlocked();
  renderGifts();
  renderLog();
}

const SOURCE_TEXT: Record<string, string> = {
  disabled: 'TikTok kapalı',
  idle: 'TikTok beklemede',
  connecting: 'TikTok bağlanıyor',
  connected: 'TikTok yayında',
  offline: 'TikTok yayını kapalı',
  error: 'TikTok hatası',
};

function sourceLabel(status: string): string {
  return SOURCE_TEXT[status] ?? status;
}

setInterval(render, 250);
setInterval(() => room.refreshStatus(), 3000);
