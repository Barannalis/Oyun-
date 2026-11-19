import { createApp } from './app';
import { ConfigError, loadConfig } from './config';
import { createTikTokConnectionFactory } from './sources/tiktokConnection';

let config: ReturnType<typeof loadConfig>;
try {
  config = loadConfig(process.env);
} catch (err) {
  console.error(`Yapılandırma hatası: ${err instanceof ConfigError ? err.message : String(err)}`);
  process.exit(1);
}

if (config.hostTokenIsDefault) {
  console.warn('[uyarı] HOST_TOKEN tanımlı değil, geliştirme varsayılanı kullanılıyor. Dağıtımdan önce mutlaka değiştirin.');
}

let tiktok: Parameters<typeof createApp>[0]['tiktok'];
if (config.tiktok) {
  // Kütüphane yalnızca bu dalda yüklenir. Kapalıyken hiç içe aktarılmaz.
  const createConnection = await createTikTokConnectionFactory({ signApiKey: config.tiktok.signApiKey });
  tiktok = { uniqueId: config.tiktok.uniqueId, createConnection };
  console.warn(
    '[uyarı] TikTok adaptörü açık. Resmi olmayan bir kütüphane kullanılıyor: hizmet koşulu ve kesinti riski vardır (README).',
  );
}

const app = await createApp({
  port: config.port,
  host: config.host,
  hostToken: config.hostToken,
  corsOrigins: config.corsOrigins,
  giftDbPath: config.giftDbPath,
  staticRoot: config.overlayDist,
  tiktok,
});
console.log(
  `Oyun sunucusu hazır: ${app.url()} · TikTok: ${config.tiktok ? 'açık' : 'kapalı'} · panel: ${config.overlayDist ? 'sunuluyor' : 'yok'}`,
);

let closing = false;
const shutdown = async (signal: string): Promise<void> => {
  if (closing) return;
  closing = true;
  console.log(`${signal} alındı, sunucu kapatılıyor`);
  try {
    await app.close();
    process.exit(0);
  } catch (err) {
    console.error('Kapatma sırasında hata:', err);
    process.exit(1);
  }
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
