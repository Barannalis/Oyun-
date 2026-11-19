import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import type { AckResult } from '@ttl/game-core';
import { createApp, type App } from '../src/app';

const HOST = 'http-test-host';
let app: App | null = null;
let root = '';
let secretDir = '';
const sockets: Socket[] = [];

beforeEach(() => {
  secretDir = mkdtempSync(join(tmpdir(), 'ttl-secret-'));
  writeFileSync(join(secretDir, 'secret.txt'), 'GIZLI');
  root = join(secretDir, 'site');
  mkdirSync(join(root, 'assets'), { recursive: true });
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>panel-isaretci</title>');
  writeFileSync(join(root, 'overlay.html'), '<!doctype html><title>overlay-isaretci</title>');
  writeFileSync(join(root, 'assets', 'app.js'), 'console.log(1)');
});

afterEach(async () => {
  for (const s of sockets) s.disconnect();
  sockets.length = 0;
  if (app) await app.close();
  app = null;
  rmSync(secretDir, { recursive: true, force: true });
});

/** Ham HTTP isteği. fetch, ../ yollarını istemci tarafında normalleştirdiği için burada kullanılmaz. */
function raw(path: string, port: number): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function start(): Promise<{ port: number }> {
  app = await createApp({ port: 0, hostToken: HOST, corsOrigins: [], seed: 51, giftDbPath: ':memory:', staticRoot: root });
  return { port: Number(new URL(app.url()).port) };
}

describe('statik sunum ve güvenlik başlıkları', () => {
  it('kök yolu panel sayfasını, overlay.html yayın ekranını sunar', async () => {
    const { port } = await start();
    const panel = await raw('/', port);
    expect(panel.status).toBe(200);
    expect(panel.body).toContain('panel-isaretci');
    expect(String(panel.headers['content-type'])).toContain('text/html');
    expect(panel.headers['x-content-type-options']).toBe('nosniff');
    expect(panel.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(String(panel.headers['content-security-policy'])).toContain("default-src 'self'");
    expect((await raw('/overlay.html', port)).body).toContain('overlay-isaretci');
  });

  it('varlıklar uzun süre önbelleğe alınır ve doğru türü alır', async () => {
    const { port } = await start();
    const asset = await raw('/assets/app.js', port);
    expect(asset.status).toBe(200);
    expect(String(asset.headers['content-type'])).toContain('javascript');
    expect(String(asset.headers['cache-control'])).toContain('immutable');
  });

  it('klasör dışına çıkan yollar engellenir', async () => {
    const { port } = await start();
    const traversal = await raw('/%2e%2e/secret.txt', port);
    expect(traversal.status).toBe(403);
    expect(traversal.body).not.toContain('GIZLI');
    const encoded = await raw('/..%2f..%2fsecret.txt', port);
    expect(encoded.body).not.toContain('GIZLI');
  });

  it('bulunmayan dosya 404 döner, sağlık ucu çalışır', async () => {
    const { port } = await start();
    expect((await raw('/yok.txt', port)).status).toBe(404);
    const health = await raw('/health', port);
    expect(health.status).toBe(200);
    expect(JSON.parse(health.body)).toEqual({ ok: true });
  });
});

describe('yönetici anahtarı deneme sınırı', () => {
  it('çok sayıda yanlış denemede soket kesilir', async () => {
    const { port } = await start();
    const socket = io(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true, reconnection: false });
    sockets.push(socket);
    await new Promise<void>((resolve) => socket.once('connect', () => resolve()));

    let answered = 0;
    for (let i = 0; i < 30 && socket.connected; i++) {
      const res = await new Promise<AckResult | null>((resolve) => {
        const timer = setTimeout(() => resolve(null), 500);
        socket.emit('host:stop', { token: 'yanlis' }, (r: AckResult) => {
          clearTimeout(timer);
          resolve(r);
        });
      });
      if (res) answered++;
    }
    const t0 = Date.now();
    while (socket.connected && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 20));
    expect(socket.connected).toBe(false);
    expect(answered).toBeGreaterThan(0);
  });

  it('doğru anahtar ile yönetici işlemi kabul edilir', async () => {
    const { port } = await start();
    const socket = io(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true, reconnection: false });
    sockets.push(socket);
    await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
    const r = await new Promise<AckResult>((resolve) => socket.emit('host:stop', { token: HOST }, resolve));
    expect(r).toEqual({ ok: false, reason: 'not_playing' });
    expect(socket.connected).toBe(true);
  });
});
