# CANAVAR AVI · TikTok LIVE İnteraktif Oyun Platformu

TikTok LIVE yorumlarıyla oynanan, sunucu otoriteli (server-authoritative) 2D çok oyunculu oyun.
Yayıncı bir bağlantı alır, OBS veya LIVE Studio'ya tarayıcı kaynağı olarak ekler. İzleyiciler yorumla
oyuna katılır, hediyelerle oyunun gidişatını değiştirir.

## Durum

| Aşama | Durum |
|---|---|
| 1. Analiz ve fizibilite | Tamamlandı |
| 2. Oyun prototipi | Tamamlandı |
| 3. Çok oyunculu sunucu (Socket.IO, 20 oyuncu, yeniden bağlanma, spam filtresi) | Tamamlandı |
| 4. TikTok LIVE adaptörü (opsiyonel, varsayılan kapalı) | Kod ve testler tamamlandı; gerçek yayında doğrulama bekliyor |
| 5. Hediye sistemi (eşleme paneli, SQLite) | Tamamlandı |
| 6. Yayıncı paneli (anahtar girişi, yayın bağlantısı, engelleme, zorluk) | Tamamlandı |
| 7. Test, sertleştirme, dağıtım (Docker, Caddy/TLS) | Tamamlandı; canlı domain ve gerçek TikTok yayını doğrulanmadı |

## Yapı

```
packages/game-core/   Saf TypeScript oyun mantığı ve sunucu-istemci protokolü (Phaser ve ağdan bağımsız)
apps/server/          Socket.IO oyun sunucusu, oyun odası, TikTok adaptörü, statik dosya sunumu
apps/overlay/         Yayın ekranı (overlay.html, Phaser 3) ve yayıncı paneli (index.html, Vite)
```

## Hızlı başlangıç (geliştirme)

Gereksinim: Node.js 22 veya üstü.

```bash
npm install
npm run dev:all      # sunucu (3000) ve panel (5173) birlikte, Ctrl+C ile ikisi birden kapanır
npm run check        # tip denetimi + lint + tüm testler + derleme
npm run lint         # yalnızca lint
npm run start        # yalnızca oyun sunucusu, http://127.0.0.1:3000
npm run dev          # yalnızca yayıncı paneli, http://127.0.0.1:5173
npm run loadtest     # 90 soketli yük testi (sunucuyu geçici olarak kendisi başlatır)
```

Geliştirmede panel anahtarı `dev-host-token` değeridir. Panelde "Giriş yap" ile girin.

## Tek dosyalık prototip

Sunucu ve kurulum gerektirmeyen bir demo: `npm run prototype` komutu `prototype/dist/canavar-avi-prototip.html`
dosyasını üretir. Dosyayı herhangi bir tarayıcıda açın. Oyun kuralları gerçek `game-core` kodundan gelir,
yorumlar simüle edilir.

## Yayıncı paneli

1. Panelde yayıncı anahtarını girin. Anahtar yalnızca tarayıcı oturumunda saklanır.
2. "Yayın bağlantısı" alanındaki adresi OBS veya LIVE Studio'da **tarayıcı kaynağı** olarak ekleyin.
   Önizleme panelde görünür.
3. Lobide oyuncular yorumla `GİR` yazarak katılır. Zorluğu seçin, "Maçı başlat" ile oyunu başlatın.
4. "Maçı durdur" maçı kazanansız bitirir. "Yeni oda" lobiyi sıfırlar ve **eski yayın bağlantısını geçersiz kılar**;
   yeni bağlantıyı yeniden kopyalamanız gerekir.
5. Oyuncular tablosunda "Engelle" ile bir oyuncuyu engelleyebilirsiniz. Lobide oyuncu çıkarılır ve
   yeniden katılamaz. Maçtaysa karakteri haritada kalır ama komutları ve hediyeleri yok sayılır.
   Engeli "Engellenenler" listesinden kaldırabilirsiniz.
6. Hediye eşlemelerini panelden yönetin. Yalnızca eşlemesi olan hediyeler oyuna etki eder.

## Oyun kuralları (MVP)

- Katil rastgele seçilir. Diğerleri hayatta kalanlardır. En az 2, en fazla 20 oyuncu.
- Hayatta kalanlar 4 jeneratörü çalıştırmaya çalışır. Komşu karede `GÖREV` ile ilerlenir.
- Katil komşu hayatta kalanı `GÖREV` ile yakalar. Yakalananı `KURTAR` ile 5 kez kurtarmak gerekir.
- Kurtarılan oyuncu 3 saniye boyunca tekrar yakalanamaz.
- Gündüz 90 sn, gece 60 sn. Gece görüş alanı daralır.
- Bitiş: tüm jeneratörler çalışırsa hayatta kalanlar kazanır. Tüm hayatta kalanlar yakalanırsa veya 5 dakika
  dolarsa katil kazanır. Yayıncı durdurursa kazanan yoktur.
- Zorluk: kolay / normal / zor. Görev ilerlemesi, yakalama beklemesi ve katilin hızını değiştirir.
- Yorum hız sınırı: kullanıcı başına en fazla 6 ardışık yorum, saniyede 4 yenileme.

### Hediyeler

| Kademe | Etki | Kime |
|---|---|---|
| Küçük | Hız bonusu (8 sn, hareket beklemesi yarıya iner) | Gönderen oyuncu |
| Orta | Kalkan (bir yakalamayı engeller, 20 sn) | Gönderen hayatta kalan |
| Büyük | Canavarı güçlendirme (15 sn, daha hızlı ve daha kısa yakalama beklemesi) | Katil |
| Özel | Karartma (10 sn) veya jeneratör sıçraması (rastgele, tohumdan belirlenir) | Herkes |

Hediye, yalnızca TikTok'ta seri bittiğinde sayılır. Oyuncu olmayan izleyicinin kişisel hediyesi yok sayılır.

## Sunucu ortam değişkenleri

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `NODE_ENV` | — | `production` olduğunda sıkı kurallar uygulanır (aşağıya bakın) |
| `PORT` | `3000` | Dinlenen port (1-65535) |
| `HOST` | `127.0.0.1` | Dinlenen adres. Konteynerde `0.0.0.0` |
| `HOST_TOKEN` | geliştirmede `dev-host-token` | Yayıncı paneli anahtarı. Üretimde zorunlu, en az 24 karakter |
| `CORS_ORIGINS` | geliştirmede yerel panel adresleri | Ek izinli kaynaklar (virgülle). Aynı alan adından sunulan panel için boş bırakılır |
| `OVERLAY_DIST` | — | Derlenmiş panel ve yayın ekranı klasörü. Verilirse sunucu bunları da sunar |
| `GIFT_DB` | `./data/gifts.db` | Hediye eşlemelerinin SQLite dosyası |
| `TIKTOK_ENABLED` | `0` | `1` ise TikTok LIVE yorumları dinlenir |
| `TIKTOK_UNIQUE_ID` | — | Dinlenecek yayıncının TikTok kullanıcı adı (`TIKTOK_ENABLED=1` ile zorunlu) |
| `SIGN_API_KEY` | — | Kütüphanenin imza servisi (Euler Stream) anahtarı, gerekirse |

Hatalı ayarlar açılışta tek bir mesajla raporlanır ve sunucu başlamaz.

Yayın ekranı ve panel için geliştirme değişkenleri: `apps/overlay/.env.development` (`VITE_SERVER_URL`).

## Dağıtım (Docker Compose + Caddy)

Önkoşullar: Docker ve Docker Compose, alan adı (DNS kaydı bu sunucunun IP adresine yönlendirilmiş),
80 ve 443 portları açık.

```bash
cp .env.example .env
# .env dosyasını düzenleyin: DOMAIN, HOST_TOKEN (en az 24 karakter, rastgele)
docker compose up -d --build
docker compose ps            # app ve caddy "healthy/running" olmalı
```

Caddy, alan adı için TLS sertifikasını otomatik alır ve yeniler. Sunucu yalnızca Compose ağı içinde
dinler, dışarıya yalnızca Caddy açılır. Yayın bağlantısı `https://<DOMAIN>/overlay.html?...` biçimindedir.

Güncelleme: `git pull && docker compose up -d --build`. Hediye veritabanı `gifts` adlı kalıcı birimde durur.

### Üretim kontrol listesi

- [ ] `HOST_TOKEN` rastgele ve en az 24 karakter (`.env` dosyasında, depoda değil).
- [ ] DNS kaydı doğru ve 443 portu açık (Caddy sertifikası için).
- [ ] `docker compose ps` çıktısında uygulama "healthy".
- [ ] Panelde anahtar ile giriş yapılabiliyor, yanlış anahtarla giriş reddediliyor.
- [ ] Yayın ekranı bağlantısı `https` ile açılıyor ve "Sunucuya bağlanılıyor" uyarısı kayboluyor.
- [ ] Yedekleme: `gifts` biriminin yedeği alınıyor (hediye eşlemeleri oradadır).

### Güvenlik özeti

- Yayıncı anahtarı yalnızca panelde ve tarayıcı oturumunda bulunur; yayın ekranına gömülmez.
- Yayın ekranı yalnızca görüntüler. Oda kimliği olmayan veya eski bağlantılar reddedilir.
- Yanlış yönetici anahtarı denemeleri soket başına 20 ile sınırlıdır, sonra bağlantı kesilir.
- Güvenlik başlıkları: `Content-Security-Policy`, `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`. Statik dosya sunumu klasör dışına çıkamaz.
- Konteyner root olmayan `node` kullanıcısıyla çalışır.

## TikTok adaptörü hakkında önemli notlar

TikTok'un herkese açık, resmi bir LIVE yorum API'si bulunmuyor. Adaptör bu yüzden açık kaynak
`tiktok-live-connector` kütüphanesini kullanır. Bu kütüphane:

- **Resmi değildir.** Tersine mühendislik ürünüdür. TikTok değişiklik yaparsa bağlantı kesilebilir.
- **AGPL-3.0 lisanslıdır.** Sunucuyu bir ağ hizmeti olarak yayınlarsanız lisans yükümlülükleri doğabilir.
  Ticari dağıtımdan önce hukuki durumu gözden geçirin.
- **Üçüncü taraf imza servisine dayanır** (Euler Stream). Bu servis ücretli olabilir ve `SIGN_API_KEY` isteyebilir.
- **TikTok hizmet koşullarına aykırı olabilir.** Kullanım sorumluluğu size aittir.

Adaptör varsayılan olarak kapalıdır. Kapalıyken kütüphane hiç yüklenmez ve oyun simülatörle tam çalışır.
Bağlantı kopması ve "yayın kapalı" durumlarında adaptör üssel geri çekilmeyle yeniden dener ve durumunu
panele bildirir. Yayın kapalıyken hata "Failed to retrieve Room ID" biçiminde görünür; bu beklenen bir durumdur.

Gerçek yayında doğrulama için yayıncının kullanıcı adı ve aktif bir LIVE yayını gerekir. Bu geliştirme
ortamında canlı yayın akışı doğrulanmadı.

## Testler ve kalite

| Komut | Kapsam |
|---|---|
| `npm run check` | Tip denetimi, lint, tüm testler, derleme |
| `npm run lint` | ESLint (TypeScript kuralları, kullanılmayan kod dahil) |
| `npm test` | game-core 112 test, sunucu 62 test (soket entegrasyonu, HTTP, yapılandırma, TikTok sahte bağlantısı) |
| `npm run loadtest` | 90 soket, 20 oyuncu, spam senaryosu, gecikme ölçümü |

Son yük testi sonucu (aynı makinede istemci ve sunucu, 10 sn): 90 bağlantı kuruldu, 20 oyuncu katıldı,
21. oyuncu reddedildi, 780 komut hatasız işlendi, durum gecikmesi p50 4 ms, p95 7 ms, p99 11 ms.
Tarayıcı testi (panel ve yayın ekranı, üretim konteynerinde): 14 kontrol geçti, CSP engellemesi yok.

Bilinen sınırlar: tek oda çalışır (çoklu yayıncı için oda yönetimi gerekir), yayın ekranı paketi
yaklaşık 1.5 MB (Phaser), konteyner imajı yaklaşık 540 MB.

## Geliştirme ilkeleri

- Oyun durumu yalnızca `step()` ile değişir. Komutlar sıraya alınır ve tick sınırında işlenir; aynı tohum
  ve aynı komut sırası her zaman aynı sonucu verir.
- Tüm yorum girişleri (soket, simülatör, TikTok) tek bir kapıdan geçer: `GameRoom.submitChat`.
- Test edilmemiş özellik tamamlanmış gibi sunulmaz.
