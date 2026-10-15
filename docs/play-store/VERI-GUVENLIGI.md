# Play Veri Güvenliği (Data safety) Formu — Cevap Taslağı

Kaynaklar: kod (`app.config.ts`, `tracker.ts`, API denetleyicileri), [THREAT_MODEL.md](../THREAT_MODEL.md), [PROTOCOL.md](../PROTOCOL.md), BARGU_PLAN §4–5, DURUM.md. Form kuralları: [Google: Data safety](https://support.google.com/googleplay/android-developer/answer/10787469).

## Önce iki karar

1. **Uçtan uca şifreli veri formda "toplanan" sayılır mı?** Google'ın metni: gönderen ve alıcı dışında kimsenin (geliştirici dahil) okuyamadığı, uçtan uca şifreli veri beyan edilmek zorunda **değil**. Konum, fotoğraf, yer, geçmiş buna uyuyor (sunucu anahtara sahip değil). **Öneri: yine de beyan et** (aşağıdaki tabloda), her satıra "uçtan uca şifreli" açıklaması. Neden: izin inceleme sorularıyla uyumlu, güven mesajıyla tutarlı, fazla beyan etmenin cezası yok; eksik beyanın var. Sahip kararı: katı okuma (hiçbirini beyan etme) da politikaya uygun, ama inceleme sürtünmesi artar.
2. **"Veri silme talebi" sorusu.** Şu an uygulamada hesap silme **yok** (kod oturumu işi K7). K7 bitmeden "Evet" deme; "Hayır" dersen Play uygulamayı hesap silme politikası nedeniyle reddedebilir. Taslak cevaplar K7 bitmiş varsayar.

## Bölüm 1 — Genel sorular

| Soru                                                    | Cevap                                                                                                                      |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Uygulama kullanıcı verisi topluyor ya da paylaşıyor mu? | **Evet**                                                                                                                   |
| Toplanan tüm veri aktarım sırasında şifreleniyor mu?    | **Evet.** TLS 1.3 (staging'de zorunlu), ayrıca içerik uçtan uca şifreli                                                    |
| Kullanıcıların veri silme talep etmesi için yol var mı? | **Evet** (K7 sonrası). Uygulama içi: Ayarlar → Hesabı sil. Web: gizlilik sitesindeki silme sayfası (URL Console'a yazılır) |
| Play Families politikasına uyumlu mu?                   | Çocuklara yönelik değil. Hedef kitle kararı IZINLER.md §5                                                                  |
| Bağımsız güvenlik incelemesi (MASVS) rozeti             | **Hayır** (Faz 10 pentest sonrası düşünülür)                                                                               |

## Bölüm 2 — Toplanan veri türleri

Her satırda varsayılan: **Toplanıyor mu: evet · Paylaşılıyor mu: HAYIR · Zorunlu mu: aşağıda · Amaç: aşağıda**.

| Play kategorisi / tür                       | Bargu'da ne                                                                                                | Zorunlu                                     | Amaç                                                                               | Not                                                                                                                                                                         |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Kişisel bilgiler → E-posta adresi**       | Giriş için e-posta; 4 haneli kodla doğrulama                                                               | Zorunlu                                     | Hesap yönetimi, uygulama işlevi                                                    | Veritabanında düz e-posta yok: anahtarlı özet; kuyruktaki adres şifreli (THREAT_MODEL). Kod göndermek için e-posta servisi "hizmet sağlayıcı" (paylaşım sayılmaz)           |
| **Kişisel bilgiler → Ad**                   | Görünen ad (kullanıcının yazdığı takma ad), renk, emoji                                                    | Zorunlu                                     | Uygulama işlevi                                                                    | Sunucuda şifresiz (THREAT_MODEL "kabul edilen sızıntılar")                                                                                                                  |
| **Kişisel bilgiler → Kullanıcı kimlikleri** | Kullanıcı adı (@ad), hesap kimliği (UUID)                                                                  | Zorunlu                                     | Uygulama işlevi, hesap yönetimi                                                    |                                                                                                                                                                             |
| **Konum → Kesin konum**                     | Seçilen çemberlerle canlı paylaşılan GPS konumu                                                            | İsteğe bağlı (kullanıcı paylaşımı başlatır) | Uygulama işlevi                                                                    | **Uçtan uca şifreli.** Sunucu yalnızca şifreli zarfı Redis'te en çok 24 saat tutar. Çember geçmişi açılırsa şifreli parçalar 14 gün                                         |
| **Konum → Yaklaşık konum**                  | Hassasiyet "mahalle/şehir" seçilince daha kaba konum                                                       | İsteğe bağlı                                | Uygulama işlevi                                                                    | Kabalaştırma telefonda yapılır, yine şifreli gider                                                                                                                          |
| **Fotoğraf ve videolar → Fotoğraflar**      | Profil fotoğrafı                                                                                           | İsteğe bağlı                                | Uygulama işlevi                                                                    | Şifreli yüklenir; yalnızca güvenilen arkadaşlar açar. Kamera yalnızca QR okur, kayıt yok                                                                                    |
| **Uygulama bilgisi ve performans**          | —                                                                                                          | —                                           | —                                                                                  | Kilitlenme raporu / analitik kitaplığı **yok** (bağımlılıklarda Sentry, Firebase Analytics vb. çıkmadı; yayın öncesi `pnpm why` ile son kez doğrula). Seçme: **toplamıyor** |
| **Cihaz veya diğer kimlikler**              | Cihaz kimlik/DH açık anahtarları, FCM bildirim token'ı, Play Integrity doğrulaması (cihaz kimliğine bağlı) | Zorunlu                                     | Uygulama işlevi, hesap yönetimi, **dolandırıcılığı önleme, güvenlik ve uyumluluk** | Reklam kimliği kullanılmıyor                                                                                                                                                |
| **Mesajlar → Diğer uygulama içi mesajlar**  | Dürtme, "geç kalacağım", varış/ayrılış bildirimleri, etkinlik planı ve oylar                               | İsteğe bağlı                                | Uygulama işlevi                                                                    | Şifreli; sunucu yalnızca tür + çember kimliği görür. İsterseniz katı okumada beyan edilmez                                                                                  |
| Kişiler (rehber)                            | **Toplanmıyor**                                                                                            |                                             |                                                                                    | Rehber izni yok                                                                                                                                                             |
| Finansal bilgi                              | **Toplanmıyor** (şimdilik)                                                                                 |                                             |                                                                                    | Bargu+ gelince: satın alma geçmişi Play Faturalandırma üzerinden; Play bunu ayrıca yönetir. O zaman satırı güncelle                                                         |
| Sağlık, Web geçmişi, Ses, Takvim, Dosyalar  | **Toplanmıyor**                                                                                            |                                             |                                                                                    | Mikrofon engelli (`blockedPermissions`)                                                                                                                                     |

IP adresi: sunucu isteklerde görür ve hız sınırı için kullanır, **log'lanmaz** (CLAUDE.md kuralı). Play'de ayrı kategori değil; "kimlikler"e dahil beyan gerekmez. Bunu gizlilik politikasında yaz.

## Bölüm 3 — Paylaşım

| Soru                                    | Cevap                                                                                                                                                                                                                                                                  |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Veri üçüncü taraflarla paylaşılıyor mu? | **Hayır.** Hiçbir veri türü "paylaşılıyor" işaretlenmez                                                                                                                                                                                                                |
| Neden doğru?                            | Reklam, analitik, veri aracısı yok. Konum verisi satılmaz. Haritalar, yazı tipleri ve karolar kendi sunucumuzda                                                                                                                                                        |
| Hizmet sağlayıcılar (paylaşım sayılmaz) | Barındırma: Hetzner (AB). Bildirim: Google FCM (içerik şifreli, token görür). E-posta: SMTP sağlayıcı (şu an Gmail/iç Mailpit; yayına alınırken AB'de işlem yapan bir e-posta servisi seç). Hava: Open-Meteo yalnızca sabit ızgara (kullanıcı verisi gitmez, ADR 0013) |

## Bölüm 4 — Güvenlik uygulamaları

| Soru                                      | Cevap                                                                                                                   |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Veri aktarımda şifreli                    | Evet                                                                                                                    |
| Silme talebi mümkün                       | Evet (K7 sonrası)                                                                                                       |
| Tüm veriler kullanıcıya özel, silinebilir | Çember geçmişi kapatılınca sunucudan silinir; etkinlik çemberi bitince silinir (30 sn işçi); hesap silinince hepsi (K7) |

## Bölüm 5 — Silme ve saklama (politikada da yazılacak)

| Veri                          | Saklama                                                                                                          |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Canlı konum zarfı             | Redis, en çok 24 saat                                                                                            |
| Çember geçmişi (isteğe bağlı) | En çok 14 gün, şifreli; kapatınca silinir                                                                        |
| Etkinlik çemberi              | Bitince tüm kayıtlar silinir                                                                                     |
| Hesap                         | Silme talebiyle (K7); güvenlik/kötüye kullanım için tutulacak bir şey varsa süresiyle birlikte politikada belirt |
| Oturum, davet, kod            | Kısa ömürlü (10 dk erişim token'ı, 24 sa davet)                                                                  |

## Tutarlılık kontrolleri (gönderimden önce)

- Gizlilik politikasındaki veri listesi bu tabloyla aynı olmalı.
- Manifest izinleri (aşağıdaki IZINLER.md) formla uyumlu: konum, bildirim, kamera (QR). Ek izin eklenirse formu güncelle.
- Bargu+ eklenince "Finansal bilgi / satın alma" ve Play Faturalandırma satırı.
- Her sürümde `pnpm why` ile yeni SDK eklenmediğini doğrula (SDK'ların topladığı veri de sizin sorumluluğunuz).
