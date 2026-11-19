// Minimal client for the virtual MVP. No framework, no build step.
// Session token lives in sessionStorage: a per-viewer convenience only.
const TOKEN_KEY = 'gbp.token';
const LOCALE_KEY = 'gbp.locale';
const state = { token: null, user: null, locale: 'en', messages: {}, countries: [], mode: 'virtual', availability: null, realCurrency: null };

const $ = (sel) => document.querySelector(sel);
const t = (key, params = {}) => {
  let s = state.messages[key] ?? key;
  for (const [k, v] of Object.entries(params)) s = s.replace(`{${k}}`, v);
  return s;
};

async function api(path, { method = 'GET', body } = {}) {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (state.token) headers.authorization = `Bearer ${state.token}`;
  const res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error?.message ?? t('ui.error_generic'));
    err.payload = data.error;
    throw err;
  }
  return data;
}

/** Human text for a list of reason codes (from /me or an error), in the active language. */
function reasonsText(reasons = []) {
  return reasons.map((r) => r.message ?? t(`reason.${r.code}`)).join(' ');
}

function say(text, isError = false) {
  const el = $('#message');
  el.textContent = text;
  el.style.color = isError ? 'var(--error)' : '';
}

function fmt(minor, currency, exponent = 2) {
  const value = (minor / 10 ** exponent).toFixed(exponent);
  return currency === 'VC' ? `${value} VC` : `${value} ${currency}`;
}

/** The currency used for the current mode. Real money uses the first permitted currency, if any. */
function activeCurrency() {
  return state.mode === 'virtual' ? 'VC' : state.realCurrency;
}

async function loadLocale(locale) {
  const data = await api(`/api/v1/i18n/${encodeURIComponent(locale)}`);
  state.locale = data.locale;
  state.messages = data.messages;
  localStorage.setItem(LOCALE_KEY, state.locale);
  document.documentElement.lang = state.locale;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
}

async function boot() {
  const countries = await api('/api/v1/countries');
  state.countries = countries;
  const sel = $('#country-select');
  sel.innerHTML = countries.map((c) => `<option value="${c.code}">${c.name}</option>`).join('');
  const langs = ['en', 'fr'];
  $('#lang').innerHTML = langs.map((l) => `<option value="${l}">${l.toUpperCase()}</option>`).join('');
  await loadLocale(localStorage.getItem(LOCALE_KEY) ?? 'en');
  $('#lang').value = state.locale;

  state.token = sessionStorage.getItem(TOKEN_KEY);
  if (state.token) {
    try { await refreshMe(); return; } catch { sessionStorage.removeItem(TOKEN_KEY); state.token = null; }
  }
  showAuth();
}

function showAuth() {
  $('#auth').hidden = false; $('#app').hidden = true; $('#logout').hidden = true; $('#who').textContent = '';
}

function showApp() {
  $('#auth').hidden = true; $('#app').hidden = false; $('#logout').hidden = false;
  $('#who').textContent = t('ui.signed_in_as', { name: state.user.displayName });
}

async function refreshMe() {
  const me = await api('/api/v1/me');
  state.user = me.user;
  state.availability = me.availability;
  state.realCurrency = me.realMoney.currencies[0] ?? null;
  const vc = me.wallets.find((w) => w.mode === 'virtual')?.balances.find((b) => b.currency === 'VC');
  $('#balance').textContent = vc ? fmt(vc.amountMinor, 'VC', vc.exponent) : '—';
  $('#wallet-json').textContent = JSON.stringify(me.wallets, null, 2);
  $('#availability-json').textContent = JSON.stringify(me.availability, null, 2);
  showApp();
  renderModeNote();
  await loadEvents();
}

function renderModeNote() {
  const sports = state.availability?.[state.mode]?.sports;
  const note = $('#mode-note');
  if (!sports) { note.textContent = ''; return; }
  note.textContent = sports.allowed ? '' : reasonsText(sports.reasons);
  document.querySelectorAll('.mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === state.mode));
  const realBlocked = state.mode === 'real' && !sports.allowed;
  $('#mode-note').classList.toggle('warn', realBlocked);
  document.querySelectorAll('#events button.bet').forEach((b) => { b.disabled = realBlocked; });
  $('#dice-roll').disabled = state.mode === 'real' && !state.availability.real.casino.allowed;
}

async function loadEvents() {
  const { events } = await api('/api/v1/sports/events');
  const box = $('#events');
  if (!events.length) { box.textContent = t('ui.no_events'); return; }
  box.innerHTML = events.map((e) => `
    <article class="event">
      <div><strong>${escapeHtml(e.home)}</strong> — ${escapeHtml(e.away)}</div>
      <div class="muted">${escapeHtml(e.competition)} · ${t('ui.starts_at')}: ${new Date(e.startsAt).toLocaleString(state.locale)}</div>
      <label><span>${t('ui.stake')} (${activeCurrency() ?? ''})</span><input class="stake" data-event="${e.id}" value="10" inputmode="decimal" /></label>
      <div class="event-odds">
        ${['home', 'draw', 'away'].filter((s) => e.odds[s] != null).map((s) => `
          <button class="bet" data-event="${e.id}" data-selection="${s}">${t(`ui.${s}`)} ${(e.odds[s] / 10000).toFixed(2)}</button>`).join('')}
      </div>
    </article>`).join('');
  box.querySelectorAll('button.bet').forEach((b) => b.addEventListener('click', () => placeBet(b.dataset.event, b.dataset.selection)));
  renderModeNote();
}

async function placeBet(eventId, selection) {
  const stake = document.querySelector(`input.stake[data-event="${eventId}"]`).value;
  try {
    await api('/api/v1/bets', { method: 'POST', body: { eventId, selection, stake, mode: state.mode, currency: activeCurrency() } });
    say(t('ui.bet_placed'));
    await refreshMe();
  } catch (err) {
    say(reasonsText(err.payload?.details?.reasons) || err.message, true);
  }
}

$('#dice-roll').addEventListener('click', async () => {
  try {
    const { round } = await api('/api/v1/casino/games/dice/play', {
      method: 'POST',
      body: { stake: $('#dice-stake').value, mode: state.mode, currency: activeCurrency(), params: { target: Number($('#dice-target').value) } },
    });
    $('#dice-result').textContent = round.outcome.won
      ? t('ui.won', { amount: fmt(round.payout, round.currency, round.exponent) }) + ` (${round.outcome.roll})`
      : `${t('ui.lost')} (${round.outcome.roll})`;
    await refreshMe();
  } catch (err) {
    $('#dice-result').textContent = reasonsText(err.payload?.details?.reasons) || err.message;
  }
});

document.querySelectorAll('.mode-btn').forEach((b) => b.addEventListener('click', () => { state.mode = b.dataset.mode; renderModeNote(); }));
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('[data-view]').forEach((x) => x.classList.toggle('active', x === b));
  for (const v of ['sports', 'casino', 'wallet']) $(`#view-${v}`).hidden = b.dataset.view !== v;
}));

let authMode = 'login';
for (const id of ['#tab-login', '#tab-register']) {
  $(id).addEventListener('click', () => {
    authMode = id === '#tab-login' ? 'login' : 'register';
    document.querySelectorAll('#auth .tab').forEach((x) => x.classList.toggle('active', x === $(id)));
    $('#register-fields').hidden = authMode === 'login';
    $('#auth-submit').textContent = t(authMode === 'login' ? 'ui.login' : 'ui.register');
    $('#auth-error').textContent = '';
  });
}

$('#auth-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = new FormData(ev.target);
  const payload = { username: f.get('username'), password: f.get('password') };
  if (authMode === 'register') Object.assign(payload, { displayName: f.get('displayName'), country: f.get('country'), dateOfBirth: f.get('dateOfBirth'), locale: state.locale });
  try {
    const data = await api(authMode === 'login' ? '/api/v1/auth/login' : '/api/v1/auth/register', { method: 'POST', body: payload });
    state.token = data.token;
    sessionStorage.setItem(TOKEN_KEY, data.token);
    await refreshMe();
  } catch (err) {
    $('#auth-error').textContent = reasonsText(err.payload?.details?.reasons) || err.message;
  }
});

$('#logout').addEventListener('click', async () => {
  try { await api('/api/v1/auth/logout', { method: 'POST' }); } catch { /* token may already be gone */ }
  sessionStorage.removeItem(TOKEN_KEY);
  state.token = null;
  showAuth();
});

$('#lang').addEventListener('change', async (ev) => {
  await loadLocale(ev.target.value);
  if (state.user) await refreshMe();
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

boot().catch((err) => say(err.message, true));
