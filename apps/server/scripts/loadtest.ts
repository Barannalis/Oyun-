/**
 * Yük testi: 90 eşzamanlı soket (20 oyuncu, 70 izleyici), oyun boyunca
 * komut akışı, durum yayın gecikmesi ve bir spam senaryosu.
 *
 * Çalıştırma: npm run loadtest -w @ttl/server
 * Ortam değişkenleri: DURATION_MS (varsayılan 10000), CLIENTS (varsayılan 90)
 *
 * Not: İstemciler ve sunucu aynı süreçte ve aynı makinede çalışır. Ölçülen
 * CPU ve bellek değerleri ikisinin toplamıdır, gerçek sunucu için üst sınırdır.
 */
import { io, type Socket } from 'socket.io-client';
import { createApp } from '../src/app';

const TOTAL_CLIENTS = Number(process.env.CLIENTS ?? 90);
const PLAYERS = 20;
const DURATION_MS = Number(process.env.DURATION_MS ?? 10_000);
const HOST_TOKEN = 'loadtest-host';
const COMMANDS = ['SOL', 'SAĞ', 'YUKARI', 'AŞAĞI', 'GÖREV', 'KURTAR'];

interface StateMsg {
  serverTime: number;
}

type Ack = { ok: true } | { ok: false; reason: string };

function call<T>(s: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve) => s.emit(event, payload, (res: T) => resolve(res)));
}

async function waitFor(pred: () => boolean, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, 20));
  }
  return true;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function main(): Promise<void> {
  const app = await createApp({ port: 0, hostToken: HOST_TOKEN, corsOrigins: [], seed: 20260101 });
  const url = app.url();

  const sockets: Socket[] = [];
  const latencies: number[] = [];
  let stateMessages = 0;
  let eventMessages = 0;
  let initMessages = 0;

  const cpuStart = process.cpuUsage();
  const wallStart = Date.now();

  for (let i = 0; i < TOTAL_CLIENTS; i++) {
    const s = io(url, { transports: ['websocket'], forceNew: true, reconnection: false });
    s.on('init', () => initMessages++);
    s.on('state', (m: StateMsg) => {
      stateMessages++;
      latencies.push(Date.now() - m.serverTime);
    });
    s.on('events', () => eventMessages++);
    sockets.push(s);
  }

  const connected = await waitFor(() => sockets.every((s) => s.connected), 20_000);
  const connectMs = Date.now() - wallStart;

  const players = sockets.slice(0, PLAYERS);
  const spectators = sockets.slice(PLAYERS);

  const helloResults = await Promise.all(
    players.map((s, i) => call<{ ok: boolean; reason?: string }>(s, 'hello', { name: `Oyuncu${i + 1}` })),
  );
  const joined = helloResults.filter((r) => r.ok).length;

  const overflow = await call<{ ok: boolean; reason?: string }>(spectators[0], 'hello', { name: 'Fazla' });

  const startAck = await call<Ack>(players[0], 'host:start', { token: HOST_TOKEN });

  // Spam senaryosu: bir oyuncu 60 komutu art arda gönderir
  const spamResults = await Promise.all(
    Array.from({ length: 60 }, () => call<Ack>(players[1], 'command', { text: 'SOL' })),
  );
  const spamLimited = spamResults.filter((r) => !r.ok && r.reason === 'rate_limited').length;
  const spamAccepted = spamResults.filter((r) => r.ok).length;

  // Oyun boyunca her oyuncu 4 komut/sn gönderir, izleyiciler sadece dinler
  const commandAcks = { ok: 0, limited: 0, other: 0 };
  const timers = players.map((s) =>
    setInterval(() => {
      const text = COMMANDS[Math.floor(Math.random() * COMMANDS.length)];
      s.emit('command', { text }, (r: Ack) => {
        if (r.ok) commandAcks.ok++;
        else if (r.reason === 'rate_limited') commandAcks.limited++;
        else commandAcks.other++;
      });
    }, 250),
  );

  await new Promise((r) => setTimeout(r, DURATION_MS));
  for (const t of timers) clearInterval(t);

  const elapsedSec = (Date.now() - wallStart) / 1000;
  const cpu = process.cpuUsage(cpuStart);
  const sortedLat = [...latencies].sort((a, b) => a - b);
  const finalState = await new Promise<string>((resolve) => {
    const s = sockets[0];
    s.once('state', (m: { state: { phase: string } }) => resolve(m.state.phase));
  });

  const result = {
    clients: { requested: TOTAL_CLIENTS, connected: connected ? TOTAL_CLIENTS : sockets.filter((s) => s.connected).length },
    connectMs,
    lobby: { playersRequested: PLAYERS, joined, overflowRejected: overflow.ok === false && overflow.reason === 'room_full' },
    matchStart: startAck,
    spam: { sent: spamResults.length, accepted: spamAccepted, rateLimited: spamLimited },
    gameplay: {
      durationSec: DURATION_MS / 1000,
      commandsOk: commandAcks.ok,
      commandsRateLimited: commandAcks.limited,
      commandsOther: commandAcks.other,
    },
    messages: {
      initPerClient: +(initMessages / TOTAL_CLIENTS).toFixed(2),
      statePerClientPerSec: +(stateMessages / TOTAL_CLIENTS / elapsedSec).toFixed(2),
      eventBatches: eventMessages,
    },
    latencyMs: {
      samples: sortedLat.length,
      p50: percentile(sortedLat, 50),
      p95: percentile(sortedLat, 95),
      p99: percentile(sortedLat, 99),
      max: sortedLat[sortedLat.length - 1] ?? NaN,
    },
    resources: {
      cpuSecTotal: +((cpu.user + cpu.system) / 1e6).toFixed(2),
      cpuPercentAvg: +(((cpu.user + cpu.system) / 1000 / (Date.now() - wallStart)) * 100).toFixed(1),
      rssMB: +(process.memoryUsage().rss / 1024 / 1024).toFixed(1),
    },
    finalPhase: finalState,
  };

  console.log(JSON.stringify(result, null, 2));

  for (const s of sockets) s.disconnect();
  await app.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
