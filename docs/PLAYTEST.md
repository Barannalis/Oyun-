# Test lobisi rehberi

Bu rehber 6-8 kişilik bir test oyununu, katilin lobi büyüklüğüne göre ayarlanıp ayarlanmadığını ölçmek için adım adım anlatır.

## 1. Hazırlık (yayıncı bilgisayarı)

Aynı Wi-Fi ağındaki herkesin bağlanabilmesi için sunucuyu dış erişime açın. Yalnızca yerel ağ içindir; internete açmak için `docs`'taki dağıtım adımlarını izleyin (TLS gerekir).

```bash
npm install
npm run build -w @ttl/overlay
OVERLAY_DIST=$PWD/apps/overlay/dist HOST=0.0.0.0 HOST_TOKEN=<en az 24 karakter, rastgele> npm run start -w @ttl/server
```

- `OVERLAY_DIST` mutlaka mutlak yol olmalı.
- Güvenlik duvarı sorarsa Node.js'e izin verin.
- Bilgisayarınızın yerel IP adresini öğrenin (ör. `192.168.1.20`).

## 2. Yayıncı paneli

1. Tarayıcıda `http://<IP>:3000/` açın ve yayıncı anahtarıyla giriş yapın.
2. "Test lobisi" kartındaki bağlantıyı kopyalayıp oyunculara gönderin.
3. Zorluğu **Normal** bırakın.
4. Oyuncular katıldıktan sonra "Maçı başlat" deyin.
5. Maç bittiğinde "Maç kayıtları" kartından **JSON indir**'e tıklayın. Her oyuna en az 10 maç oynayın.

## 3. Oyuncu adımları

1. Bağlantıyı telefonda açın.
2. Adınızı yazıp **Katıl**'a basın.
3. Maç başlayınca rolünüz görünür: **KATİL** ya da **Hayatta kalan**.
4. Yön tuşlarıyla hareket edin. **GÖREV**:
   - Hayatta kalan: jeneratörün yanındaysanız çalıştırır.
   - Katil: yanınızdaki hayatta kalanı yakalar.
5. Yakalanırsanız bir arkadaşınız yanınıza gelip **KURTAR**'a basarsa kurtulursunuz.
6. Maç bitince her oyuncu aşağıdaki mini anketi doldurur (tek mesaj olarak yayıncıya iletin):
   - Eğlence (1-5):
   - Adil buldun mu (evet / hayır, neden):
   - Rolün zor muydu (evet / hayır):
   - Kafanı karıştıran bir şey oldu mu:

## 4. Ölçülecekler

Her maç kaydında şunlar bulunur: `durationSec`, `players`, `winner`, `reason`, `catches`, `rescues`, `generatorsDone`, `shieldBlocks`.

Denge için hedefler (önerilen, ilk tur):

| Ölçüt | Hedef |
|---|---|
| Katil kazanma oranı | %40-60 |
| Ortanca maç süresi | 2-4 dakika |
| Maç başına yakalama | 2-4 |
| Maç başına kurtarma | en az 1 |

Ölçüm karşılaştırması için iki tur yapın: önce `KILLER_SCALING.enabled: false`, sonra `true` (`packages/game-core/src/config.ts`, değiştirdikten sonra `npm run build -w @ttl/overlay` ve sunucuyu yeniden başlatın).

## 5. Veri ve gizlilik

- Maç kayıtları yalnızca yayıncının tarayıcısındadır. Oyuncu adları içerir.
- Test bitince dosyayı sakladığınız yerden silin ve paneldeki kayıtları temizleyin.
- Raporu paylaşırken oyuncu adlarını çıkarın.
