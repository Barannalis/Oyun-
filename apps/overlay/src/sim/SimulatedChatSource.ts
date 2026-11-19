import type { ChatMessage, ChatSource } from '@ttl/game-core';

/**
 * Yorum simülatörü. Gerçek TikTok yorumları yerine panelden gönderilen
 * metinleri ChatSource olarak yayar. Aşama 4'te yerine TikTok adapter'ı gelir,
 * oyun kodu değişmez.
 */
export class SimulatedChatSource implements ChatSource {
  readonly name = 'simulator';
  private readonly handlers = new Set<(message: ChatMessage) => void>();

  start(): void {
    // Simülatörün bağlanacak bir dış kaynağı yok.
  }

  stop(): void {
    this.handlers.clear();
  }

  subscribe(handler: (message: ChatMessage) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  send(user: string, text: string): void {
    const message: ChatMessage = { user, text, receivedAt: Date.now() };
    for (const handler of this.handlers) handler(message);
  }
}
