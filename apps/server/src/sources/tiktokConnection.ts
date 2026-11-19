import type { ChatConnection } from './tiktokSource';

export interface TikTokConnectionConfig {
  /** Euler Stream imza servisi anahtarı. Boşsa kütüphane SIGN_API_KEY ortam değişkenine bakar. */
  signApiKey?: string;
}

/**
 * tiktok-live-connector'ı yalnızca TikTok etkinleştirildiğinde yükler.
 * Kapalıyken kütüphane hiç içe aktarılmaz.
 *
 * Uyarı: Kütüphane resmi TikTok API'si değildir ve AGPL-3.0 lisanslıdır.
 * Bkz. README.
 */
export async function createTikTokConnectionFactory(
  config: TikTokConnectionConfig,
): Promise<(uniqueId: string) => ChatConnection> {
  const lib = await import('tiktok-live-connector');
  return (uniqueId: string) =>
    new lib.TikTokLiveConnection(uniqueId, {
      processInitialData: false,
      fetchRoomInfoOnConnect: true,
      enableExtendedGiftInfo: false,
      signApiKey: config.signApiKey,
    }) as unknown as ChatConnection;
}
