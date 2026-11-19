# CANAVAR AVI · TikTok LIVE İnteraktif Oyun Platformu

TikTok LIVE yorumlarıyla oynanan, sunucu otoriteli (server-authoritative) 2D çok oyunculu oyun.
Bu depo şu anda **Aşama 2: çalışan oyun prototipi** durumundadır.

## Durum

| Aşama | Durum |
|---|---|
| 1. Analiz ve fizibilite | Tamamlandı |
| 2. Oyun prototipi (simülatörle tek ekran) | Tamamlandı |
| 3. Çok oyunculu altyapı (Socket.IO, 20 oyuncu) | Planlandı |
| 4. TikTok adapter'ı (opsiyonel, varsayılan kapalı) | Planlandı |
| 5. Hediye ve etkileşim sistemi | Planlandı |
| 6. Yayıncı paneli | Planlandı |
| 7. Test, optimizasyon, dağıtım | Planlandı |

Resmi bir TikTok LIVE yorum/hediye API'si bulunamadı. Canlı yorum okuma adapter'ı Aşama 4'te, isteğe bağlı ve değiştirilebilir olarak eklenecek.

## Yapı

```
packages/game-core/   Saf TypeScript oyun mantığı (Phaser ve ağdan bağımsız)
apps/overlay/         Oyun ekranı (Phaser 3) ve yorum simülatörü paneli (Vite)
```

- `game-core/src/config.ts`: tüm denge ayarları (süreler, kapasite, görüş alanı, puanlar)
- `game-core/src/commands.ts`: yorum → komut çözümleme (GİR, SOL, SAĞ, YUKARI, AŞAĞI, GÖREV, KURTAR)
- `game-core/src/world.ts`: dünya durumu, tick adımı, katıl/başlat/hareket/görev/yakalama/kurtarma, bitiş koşulları
- `game-core/src/adapters.ts`: `ChatSource` arayüzü. TikTok adapter'ı bu arayüzü uygulayacak.

## Çalıştırma

Gereksinim: Node.js 22 veya üstü.

```bash
npm install
npm test            # game-core birim testleri (90 test)
npm run typecheck   # tip denetimi
npm run dev         # http://127.0.0.1:5173 adresinde oyun ekranı + simülatör paneli
npm run build       # üretim derlemesi (apps/overlay/dist)
```

Oyun ekranını OBS / LIVE Studio'da tarayıcı kaynağı olarak eklemek için, geliştirme sürümünde
`http://127.0.0.1:5173` adresini kullanabilirsiniz. Üretim dağıtımı Aşama 7'de hazırlanacak.

## Oyun kuralları (MVP)

- Katil rastgele seçilir. Diğerleri hayatta kalanlardır. En az 2 oyuncu gerekir.
- Hayatta kalanlar 4 jeneratörü çalıştırmaya çalışır. Komşu karede GÖREV ile ilerlenir.
- Katil komşu hayatta kalanı GÖREV ile yakalar. Yakalananı KURTAR ile 5 kez kurtarmak gerekir.
- Kurtarılan oyuncu 3 saniye boyunca tekrar yakalanamaz.
- Gündüz 90 sn, gece 60 sn. Gece görüş alanı daralır.
- Bitiş: tüm jeneratörler çalışırsa hayatta kalanlar kazanır. Tüm hayatta kalanlar yakalanırsa veya 5 dakika dolarsa katil kazanır.

## Geliştirme ilkeleri

- Oyun durumu yalnızca `step()` ile değişir. Komutlar sıraya alınır ve tick sınırında işlenir, böylece aynı tohum ve aynı komut sırası her zaman aynı sonucu verir.
- Test edilmemiş özellik tamamlanmış gibi sunulmaz.
