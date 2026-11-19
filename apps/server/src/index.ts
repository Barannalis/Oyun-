import { createApp } from './app';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';
const hostToken = process.env.HOST_TOKEN ?? 'dev-host-token';
const corsOrigins = (process.env.CORS_ORIGINS ?? 'http://127.0.0.1:5173,http://localhost:5173').split(',');

if (!process.env.HOST_TOKEN) {
  console.warn('[uyarı] HOST_TOKEN tanımlı değil, geliştirme varsayılanı kullanılıyor. Dağıtımdan önce mutlaka değiştirin.');
}

const app = await createApp({ port, host, hostToken, corsOrigins });
console.log(`Oyun sunucusu hazır: ${app.url()}`);
