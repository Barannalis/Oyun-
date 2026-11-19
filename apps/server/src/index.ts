import { createApp, type TikTokOptions } from './app';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';
const hostToken = process.env.HOST_TOKEN ?? 'dev-host-token';
const corsOrigins = (process.env.CORS_ORIGINS ?? 'http://127.0.0.1:5173,http://localhost:5173').split(',');

if (!process.env.HOST_TOKEN) {
  console.warn('[uyarı] HOST_TOKEN tanımlı değil, geliştirme varsayılanı kullanılıyor. Dağıtımdan önce mutlaka değiştirin.');
}

let tiktok: TikTokOptions | undefined;
if (process.env.TIKTOK_ENABLED === '1') {
  const uniqueId = process.env.TIKTOK_UNIQUE_ID?.trim();
  if (!uniqueId) {
    console.error('TIKTOK_ENABLED=1 için TIKTOK_UNIQUE_ID (TikTok kullanıcı adı) gerekli.');
    process.exit(1);
  }
  // Kütüphane yalnızca bu dalda yüklenir. Kapalıyken hiç içe aktarılmaz.
  const { createTikTokConnectionFactory } = await import('./sources/tiktokConnection');
  const createConnection = await createTikTokConnectionFactory({ signApiKey: process.env.SIGN_API_KEY });
  tiktok = { uniqueId, createConnection };
  console.warn(
    '[uyarı] TikTok adaptörü açık. Resmi olmayan bir kütüphane kullanılıyor: hizmet koşulu ve kesinti riski vardır (README).',
  );
}

const app = await createApp({ port, host, hostToken, corsOrigins, tiktok });
console.log(`Oyun sunucusu hazır: ${app.url()} · TikTok: ${tiktok ? 'açık' : 'kapalı'}`);
