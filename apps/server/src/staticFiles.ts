import { createReadStream, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/** Yanıtlara uygulanan güvenlik başlıkları. */
export function applySecurityHeaders(res: ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
      "connect-src 'self' ws: wss: http: https:; frame-src 'self'; object-src 'none'; base-uri 'self'",
  );
}

/**
 * Derlenmiş panel ve yayın ekranını sunar. Yol geçişine (../) karşı klasörün dışına çıkılamaz.
 * Dosya bulunamazsa false döner, çağıran 404 yanıtı verir.
 */
export function serveStatic(root: string, req: IncomingMessage, res: ServerResponse): boolean {
  const rawPath = (req.url ?? '/').split('?')[0];
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    res.writeHead(400);
    res.end();
    return true;
  }

  const base = resolve(root);
  const file = resolve(base, `.${decoded === '/' ? '/index.html' : decoded}`);
  if (file !== base && !file.startsWith(base + sep)) {
    res.writeHead(403);
    res.end();
    return true;
  }

  let isFile = false;
  try {
    isFile = statSync(file).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) return false;

  const isAsset = decoded.startsWith('/assets/');
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'cache-control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  createReadStream(file).pipe(res);
  return true;
}
