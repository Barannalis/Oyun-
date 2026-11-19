import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPlatform } from './app.js';
import { createHandler } from './api/http.js';
import { buildRoutes } from './api/routes.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const adminToken = process.env.ADMIN_TOKEN;
if (!adminToken || adminToken.length < 24) {
  console.error('ADMIN_TOKEN must be set (at least 24 characters). Refusing to start.');
  process.exit(1);
}

const dataFile = process.env.DATA_FILE ?? join(root, 'data', 'platform.db');
if (dataFile !== ':memory:') mkdirSync(dirname(dataFile), { recursive: true });

const platform = createPlatform({
  configDir: join(root, 'config'),
  dbFile: dataFile,
  adminToken,
  // Monetary providers are registered in code once licensed. None ship in the MVP.
  paymentProviders: [],
  webhookSecrets: {},
});

const handler = createHandler(platform, { routes: buildRoutes(), publicDir: join(root, 'src', 'web', 'public') });
const port = Number(process.env.PORT ?? 3000);
const server = createServer(handler);
server.listen(port, () => {
  console.log(`Betting platform (virtual MVP) listening on http://localhost:${port}`);
  console.log(`Jurisdiction profiles loaded: ${[...platform.config.jurisdictions.keys()].join(', ')}`);
});

const shutdown = () => {
  server.close(() => {
    platform.close();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
