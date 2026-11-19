import { randomInt, timingSafeEqual } from 'node:crypto';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server, type Socket } from 'socket.io';
import { MAX_CHAT_LENGTH, type AckResult, type HelloRequest, type HelloResult } from '@ttl/game-core';
import { GameRoom } from './room';

export interface AppOptions {
  port: number;
  host?: string;
  hostToken: string;
  corsOrigins: string[];
  seed?: number;
  reconnectGraceMs?: number;
}

export interface App {
  url(): string;
  room: GameRoom;
  close(): Promise<void>;
}

type Ack = (result: unknown) => void;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseHello(req: unknown): HelloRequest | null {
  if (!isObject(req) || typeof req.name !== 'string' || req.name.length > 64) return null;
  if (req.token !== undefined && typeof req.token !== 'string') return null;
  return req.token === undefined ? { name: req.name } : { name: req.name, token: req.token };
}

function parseText(req: unknown): string | null {
  if (!isObject(req) || typeof req.text !== 'string' || req.text.length > MAX_CHAT_LENGTH) return null;
  return req.text;
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function reply(ack: unknown, result: unknown): void {
  if (typeof ack === 'function') (ack as Ack)(result);
}

function randomSeed(): number {
  return randomInt(1, 2_000_000_000);
}

export async function createApp(opts: AppOptions): Promise<App> {
  const httpServer: HttpServer = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const io = new Server(httpServer, {
    cors: { origin: opts.corsOrigins, methods: ['GET', 'POST'] },
    maxHttpBufferSize: 16 * 1024,
  });

  const room = new GameRoom(
    { emit: (event, payload) => io.emit(event, payload) },
    { seed: opts.seed ?? randomSeed(), reconnectGraceMs: opts.reconnectGraceMs },
  );

  const isHost = (req: unknown): boolean =>
    isObject(req) && typeof req.token === 'string' && safeEqual(req.token, opts.hostToken);

  io.on('connection', (socket: Socket) => {
    socket.emit('init', room.initPayload());

    socket.on('hello', (req: unknown, ack?: unknown) => {
      const parsed = parseHello(req);
      if (!parsed) return reply(ack, { ok: false, reason: 'invalid_request' } satisfies HelloResult);
      const result = room.hello(parsed.name, parsed.token);
      if (result.ok) room.bindSocket(result.key, socket.id);
      reply(ack, result);
    });

    socket.on('command', (req: unknown, ack?: unknown) => {
      const key = room.keyOfSocket(socket.id);
      if (key === undefined) return reply(ack, { ok: false, reason: 'not_joined' } satisfies AckResult);
      const text = parseText(req);
      if (text === null) return reply(ack, { ok: false, reason: 'invalid_text' } satisfies AckResult);
      reply(ack, room.submitChat(room.nameOf(key) ?? key, text));
    });

    socket.on('host:start', (req: unknown, ack?: unknown) => {
      if (!isHost(req)) return reply(ack, { ok: false, reason: 'unauthorized' } satisfies AckResult);
      reply(ack, room.startMatch());
    });

    socket.on('host:reset', (req: unknown, ack?: unknown) => {
      if (!isHost(req)) return reply(ack, { ok: false, reason: 'unauthorized' } satisfies AckResult);
      room.reset(randomSeed());
      reply(ack, { ok: true });
    });

    socket.on('host:chat', (req: unknown, ack?: unknown) => {
      if (!isHost(req) || !isObject(req)) return reply(ack, { ok: false, reason: 'unauthorized' } satisfies AckResult);
      const user = typeof req.user === 'string' && req.user.trim().length > 0 && req.user.length <= 64 ? req.user : null;
      const text = parseText(req);
      if (user === null || text === null) return reply(ack, { ok: false, reason: 'invalid_text' } satisfies AckResult);
      reply(ack, room.submitChat(user, text));
    });

    socket.on('disconnect', () => room.onSocketDisconnect(socket.id));
  });

  room.start();
  await new Promise<void>((resolve) => httpServer.listen(opts.port, opts.host ?? '127.0.0.1', resolve));

  return {
    room,
    url: () => {
      const addr = httpServer.address() as AddressInfo;
      return `http://${opts.host ?? '127.0.0.1'}:${addr.port}`;
    },
    close: async () => {
      room.stop();
      await io.close();
    },
  };
}
