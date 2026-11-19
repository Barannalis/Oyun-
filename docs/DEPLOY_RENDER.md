# Render'da yayınlama (sanal para sitesi)

Bu belge, bahis sitesini Render üzerinde kalıcı bir HTTPS adresiyle yayınlamak içindir. Sadece sanal para modu açılır; gerçek para hiçbir ülkede açık değildir.

## Bir kerelik kurulum

1. **Render hesabı açın:** https://render.com (GitHub ile giriş yapabilirsiniz).
2. **Depoyu bağlayın:** Render'da "New" → "Blueprint" seçin ve `Barannalis/Oyun-` deposunu seçin. Dal olarak `claude/global-betting-platform-tep2o5` kullanın. Render kökteki `render.yaml` dosyasını okur.
3. **Planı onaylayın:** Kalıcı disk (SQLite veritabanı için) ücretli `starter` planda çalışır. Ödeme bilgilerini Render'a siz girersiniz.
4. **Dağıtımı başlatın:** "Apply" deyin. İlk derleme birkaç dakika sürer.
5. **Adresi alın:** Render size `https://bahis-sitesi.onrender.com` benzeri bir adres verir. Telefonunuzun tarayıcısında bu adresi açın.

## Yönetici token'ı

`ADMIN_TOKEN` Render tarafından otomatik üretilir. Değerini şu yerden görürsünüz: servis sayfası → "Environment" → `ADMIN_TOKEN`. Bu değeri kimseyle paylaşmayın. Bu sohbetteki token, bu sandbox için üretildi ve yayında kullanılmamalı; yayın için Render'ın ürettiği yeni değeri kullanın.

## Güncelleme

Depoya yeni commit gönderdiğinizde Render otomatik yeniden dağıtır. Veritabanı kalıcı diskte durduğu için hesaplar ve bakiyeler korunur.

## Notlar

- Her başlangıçta demo ülke ayarları ve spor programı yeniden yüklenir. Bu, kayıtlı hesapları silmez.
- Sunucu ilk istekten sonra uyuyabilir; ilk açılış birkaç saniye gecikebilir. Bu ücretli planda normalde olmaz.
- Gerçek para bu dağıtımda açılmaz. Açmak için `docs/JURISDICTION_LAUNCH_CHECKLIST.md` dosyasındaki tüm adımlar gerekir.
