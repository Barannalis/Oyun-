/**
 * Veri kaynağı arayüzleri. Oyun çekirdeği bu arayüzleri bilir, hiçbir
 * somut kaynağı (TikTok, simülatör, test) bilmez.
 *
 * Aşama 4'te TikTok adapter'ı bu arayüzü uygulayacak. Adapter kapalıyken
 * oyun tamamen simülatörle çalışır.
 */

export interface ChatMessage {
  user: string;
  text: string;
  receivedAt: number;
}

export interface ChatSource {
  readonly name: string;
  start(): void;
  stop(): void;
  /** Dönen fonksiyon aboneliği iptal eder. */
  subscribe(handler: (message: ChatMessage) => void): () => void;
}

/** Tamamlanmış bir hediye gönderimi (seri bittiğinde). */
export interface GiftMessage {
  user: string;
  giftName: string;
  receivedAt: number;
}
