# CANAVAR AVI · TikTok LIVE İnteraktif Oyun Platformu

TikTok LIVE yorumlarıyla oynanan, sunucu otoriteli (server-authoritative) 2D çok oyunculu oyun.

## Durum

| Aşama | Durum |
|---|---|
| 1. Analiz ve fizibilite | Tamamlandı |
| 2. Oyun prototipi | Tamamlandı |
| 3. Çok oyunculu sunucu (Socket.IO, 20 oyuncu, yeniden bağlanma, spam filtresi) | Tamamlandı |
| 4. TikTok LIVE adaptörü (opsiyonel, varsayılan kapalı) | Kod ve testler tamamlandı; gerçek yayında doğrulama bekliyor |
| 5. Hediye ve etkileşim sistemi | Planlandı |
| 6. Yayıncı paneli | Planlandı |
| 7. Test, optimizasyon, dağıtım | Planlandı |

## Yapı

```
packages/game-core/   Saf TypeScript oyun mantığı ve sunucu-istemci protokolü (Phaser ve ağdan bağımsız)
apps/server/          Socket.IO oyun sunucusu, oyun odası, TikTok adaptörü
apps/overlay/         Oyun ekranı (Phaser 3) ve yayıncı paneli (Vite)
```

- `game-core/src/config.ts`: tüm denge ve sınır ayarları
- `game-core/src/commands.ts`: yorum → komut çözümleme (GİR, SOL, SAĞ, YUKARI, AŞAĞI, GÖREV, KURTAR)
- `game-core/src/world.ts`: dünya durumu, tick adımı, katılım, maç, bitiş koşulları
- `game-core/src/protocol.ts`: sunucu-istemci mesaj sözleşmesi
- `game-core/src/adapters.ts`: `ChatSource` arayüzü. Yorum kaynakları bu arayüzü uygular.
- `apps/server/src/room.ts`: tek oyun odası. Tüm girişler (soket, simülatör, TikTok) buradan geçer, yorum hız sınırı burada uygulanır.
- `apps/server/src/sources/tiktokSource.ts`: TikTok adaptörü (yeniden deneme, bağlantı durumu)

## Çalıştırma

Gereksinim: Node.js 22 veya üstü.

```bash
npm install
npm test            # game-core ve sunucu testleri (126 test)
npm run typecheck   # tip denetimi
npm run loadtest    # 90 soketli yük testi (sunucuyu geçici olarak kendisi başlatır)
npm run start       # oyun sunucusu, http://127.0.0.1:3000
npm run dev         # oyun ekranı ve yayıncı paneli, http://127.0.0.1:5173
```

### Sunucu ortam değişkenleri

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `PORT` | `3000` | Sunucu portu |
| `HOST` | `127.0.0.1` | Dinlenen adres |
| `HOST_TOKEN` | `dev-host-token` | Yayıncı paneli yetki anahtarı. **Dağıtımdan önce mutlaka değiştirin.** |
| `CORS_ORIGINS` | `http://127.0.0.1:5173,http://localhost:5173` | İzin verilen panel adresleri |
| `TIKTOK_ENABLED` | kapalı | `1` yapılırsa TikTok LIVE yorumları dinlenir |
| `TIKTOK_UNIQUE_ID` | — | Dinlenecek yayıncının TikTok kullanıcı adı (`TIKTOK_ENABLED=1` ile zorunlu) |
| `SIGN_API_KEY` | — | Kütüphanenin imza servisi (Euler Stream) anahtarı, gerekirse |

Oyun ekranı için ortam değişkenleri (geliştirme): `VITE_SERVER_URL`, `VITE_HOST_TOKEN`.

## TikTok adaptörü hakkında önemli notlar

TikTok'un herkese açık, resmi bir LIVE yorum API'si bulunmuyor. Adaptör bu yüzden açık kaynak
`tiktok-live-connector` kütüphanesini kullanır. Bu kütüphane:

- **Resmi değildir.** Tersine mühendislik ürünüdür. TikTok değişiklik yaparsa bağlantı kesilebilir.
- **AGPL-3.0 lisanslıdır.** Sunucuyu bir ağ hizmeti olarak yayınlarsanız lisans yükümlülükleri doğabilir. Dağıtımdan önce hukuki durumu gözden geçirin.
- **Üçüncü taraf imza servisine dayanır** (Euler Stream). Bu servis ücretli olabilir ve anahtar gerektirebilir.
- **TikTok hizmet koşullarına aykırı olabilir.** Kullanım sorumluluğu size aittir.

Adaptör varsayılan olarak kapalıdır. Kapalıyken kütüphane hiç yüklenmez ve oyun, yayıncı panelindeki
simülatörle tam çalışır. Bağlantı kopması ve "yayın kapalı" durumlarında adaptör üssel geri çekilmeyle
yeniden dener ve durumunu yayıncı paneline bildirir.

Gerçek yayında doğrulama için yayıncının TikTok kullanıcı adı ve aktif bir LIVE yayını gerekir. Bu
ortamda yalnızca var olmayan bir kullanıcı adıyla bağlantı denendi. Kütüphanenin hata yolu doğrulandı,
canlı yorum akışı doğrulanmadı.

## Oyun kuralları (MVP)

- Katil rastgele seçilir. Diğerleri hayatta kalanlardır. En az 2 oyuncu gerekir, en fazla 20.
- Hayatta kalanlar 4 jeneratörü çalıştırmaya çalışır. Komşu karede GÖREV ile ilerlenir.
- Katil komşu hayatta kalanı GÖREV ile yakalar. Yakalananı KURTAR ile 5 kez kurtarmak gerekir.
- Kurtarılan oyuncu 3 saniye boyunca tekrar yakalanamaz.
- Gündüz 90 sn, gece 60 sn. Gece görüş alanı daralır.
- Bitiş: tüm jeneratörler çalışırsa hayatta kalanlar kazanır. Tüm hayatta kalanlar yakalanırsa veya 5 dakika dolarsa katil kazanır.
- Yorum hız sınırı: kullanıcı başına en fazla 6 ardışık yorum, saniyede 4 yenileme.

## Geliştirme ilkeleri

- Oyun durumu yalnızca `step()` ile değişir. Komutlar sıraya alınır ve tick sınırında işlenir, böylece aynı tohum ve aynı komut sırası her zaman aynı sonucu verir.
- Tüm yorum girişleri (soket, simülatör, TikTok) tek bir kapıdan geçer: `GameRoom.submitChat`.
- Test edilmemiş özellik tamamlanmış gibi sunulmaz.
