import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname, sep } from 'node:path';
import { DomainError, ValidationError, ForbiddenError, AuthError } from '../core/errors.js';

const MAX_BODY_BYTES = 64 * 1024;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };

/** Tiny router. Path params use :name. Access tier is enforced before the handler runs. */
export function createRouter(routes) {
  const compiled = routes.map((r) => ({
    ...r,
    keys: [...r.path.matchAll(/:(\w+)/g)].map((m) => m[1]),
    re: new RegExp('^' + r.path.replace(/:(\w+)/g, '([^/]+)') + '$'),
  }));
  return {
    match(method, pathname) {
      let pathMatched = false;
      for (const r of compiled) {
        const m = r.re.exec(pathname);
        if (!m) continue;
        pathMatched = true;
        if (r.method !== method) continue;
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        return { route: r, params };
      }
      return { route: null, methodNotAllowed: pathMatched };
    },
  };
}

/**
 * Builds the request handler. Responsibilities: authentication tier, locale
 * negotiation, body parsing, uniform error envelope, and static files.
 * @param {ReturnType<typeof import('../app.js').createPlatform>} platform
 * @param {{routes: Array<object>, publicDir: string}} opts
 */
export function createHandler(platform, { routes, publicDir }) {
  const router = createRouter(routes);
  const { i18n } = platform;

  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const acceptLanguage = i18n.fromAcceptLanguage(req.headers['accept-language']);
    // Until a player is known, the request language comes from ?lang= or Accept-Language.
    let locale = i18n.resolve([url.searchParams.get('lang'), ...acceptLanguage]);
    try {
      if (!url.pathname.startsWith('/api/')) return await serveStatic(url.pathname, res, publicDir);

      const { route, params, methodNotAllowed } = router.match(req.method, url.pathname);
      if (!route) return sendJson(res, methodNotAllowed ? 405 : 404, errorBody('not_found', i18n.t('error.not_found', {}, locale)));

      const rawBody = await readBody(req);
      const body = parseBody(rawBody, req.headers['content-type']);
      const user = route.access === 'player' || route.access === 'public' ? bearerUser(req, platform) : null;
      if (route.access === 'player' && !user) throw new AuthError();
      if (route.access === 'admin' && !isAdmin(req, platform)) throw new AuthError();

      // A signed-in player's saved language wins over the request headers.
      locale = i18n.resolve([user?.locale, url.searchParams.get('lang'), ...acceptLanguage]);
      const ctx = {
        params,
        query: Object.fromEntries(url.searchParams),
        body,
        rawBody,
        headers: req.headers,
        user,
        actor: route.access === 'admin' ? actorName(req) : user ? `player:${user.id}` : 'anonymous',
        locale,
      };
      const out = await route.handler(ctx, platform);
      return sendJson(res, out?.status ?? 200, out?.body ?? out);
    } catch (err) {
      return sendError(res, err, platform, req, locale);
    }
  };
}

function bearerUser(req, platform) {
  const h = req.headers.authorization ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  return token ? platform.services.accounts.authenticate(token) : null;
}

function isAdmin(req, platform) {
  const h = req.headers.authorization ?? '';
  if (!h.startsWith('Bearer ')) return false;
  const a = Buffer.from(h.slice(7));
  const b = Buffer.from(platform.adminToken);
  return a.length === b.length && timingSafeEqual(a, b);
}

function actorName(req) {
  const raw = String(req.headers['x-actor'] ?? 'admin').replace(/[^\w.@-]/g, '').slice(0, 64) || 'admin';
  return `admin:${raw}`;
}

async function readBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return '';
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new ValidationError('invalid_input', { field: 'body', reason: 'too_large' });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseBody(raw, contentType) {
  if (!raw) return {};
  if (!String(contentType ?? '').includes('application/json')) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : {};
  } catch {
    throw new ValidationError('invalid_input', { field: 'body', reason: 'malformed_json' });
  }
}

function errorBody(code, message, details) {
  return { error: { code, message, ...(details ? { details } : {}) } };
}

function sendError(res, err, platform, req, locale) {
  if (err instanceof DomainError) {
    const message = platform.i18n.t(`error.${err.code}`, err.details ?? {}, locale);
    if (err instanceof ForbiddenError) {
      const reasons = err.details.reasons.map((r) => ({ code: r.code, message: platform.i18n.t(`reason.${r.code}`, r.params ?? {}, locale) }));
      return sendJson(res, 403, errorBody('forbidden', platform.i18n.t('error.forbidden', {}, locale), { reasons }));
    }
    return sendJson(res, err.status, errorBody(err.code, message, safeDetails(err.details)));
  }
  console.error('[internal]', req.method, req.url, err?.stack ?? err);
  return sendJson(res, 500, errorBody('internal_error', 'Internal error.'));
}

function safeDetails(d) {
  if (!d || typeof d !== 'object') return undefined;
  const { reasons, ...rest } = d;
  return Object.keys(rest).length ? rest : undefined;
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(payload);
}

async function serveStatic(pathname, res, publicDir) {
  const rel = pathname === '/' ? 'index.html' : normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, '');
  const file = join(publicDir, rel);
  if (!file.startsWith(publicDir + sep) && file !== join(publicDir, 'index.html')) {
    return sendJson(res, 404, errorBody('not_found', 'Not found.'));
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'x-content-type-options': 'nosniff' });
    res.end(data);
  } catch {
    sendJson(res, 404, errorBody('not_found', 'Not found.'));
  }
}
