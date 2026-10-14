# 0010. Sistem bildirimleri (Faz 7'den erken, içeriksiz)

- Durum: Yerini [ADR 0016](0016-sealed-push-notifications.md) aldı (bildirimler artık şifreli)
- Tarih: 2026-10-14

## Bağlam

Proje sahibi telefonda denerken, uygulama kapalıyken çember daveti ve katılım haberlerinin
gelmemesini eksik buldu ve iznin uygulama başında istenmesini istedi. Plan sistem bildirimlerini
(APNs / FCM, içerik cihaz başına sealed box) Faz 7'ye koyuyor. Konum bildirimleri (bölgeye girdi,
SOS) şifreli içerik gerektirir ve Faz 7'de kalır; arkadaşlık ve çember haberleri ise bugün gerekiyor.

## Karar

- **Şimdi, yalnızca sosyal haberler**: arkadaşlık isteği, isteğin kabulü, QR ile yeni arkadaş,
  çember daveti, çembere katılım. Haberi yapan kişiye bildirim gitmez.
- **İçeriksiz metin**: bildirim yalnızca ne tür bir şey olduğunu söyler ("Bir çembere davet
  edildin"); kim, hangi çember yazmaz. Bu metinler Google'dan (FCM) ve ileride Apple'dan geçer;
  kimin kimi davet ettiği onlara gitmez. Ayrıntıyı uygulama açılınca gösterir (uygulama içi
  bildirimler, ADR 0009).
- **Aracısız**: sunucu FCM HTTP v1'e kendi Firebase hizmet hesabıyla bağlanır (Expo push servisi
  veya başka bir aktarıcı yok). Google OAuth kodu Play Integrity ile ortak
  (`infra/google/service-account.ts`).
- **Push token'ı gizli tutulur**: cihaz başına bir satır (`app.push_tokens`), sunucu anahtarıyla
  şifreli (XChaCha20-Poly1305), RLS ile yalnızca sahibine açık; log'a, kuyruğa yazılmaz. Yalnızca
  hesabın aktif cihazına gönderilir; çıkışta ve cihaz değişince silinir; FCM "kayıtlı değil"
  derse unutulur.
- **Kuyruk**: pg-boss `push.send` (iş: kullanıcı, tür, çember kimliği). Aynı haber aynı çember için
  dakikada bir (yığılma yok), geçici hatalarda artan beklemeyle tekrar, bir saatten eski haber
  gönderilmez. Yalnızca işçi dışarı çıkabilir (`egress` ağı).
- **Telefonda**: giriş/kayıt biter bitmez sistem izni bir kez istenir (Android 13+'ta önce kanal
  oluşur: "Arkadaşlar ve çemberler"). Uygulama açıkken sistem bildirimi gösterilmez (uygulama içi
  bildirim yeter), öne gelince tepsideki bildirimler temizlenir, bildirime dokunmak çemberi açar.
  "Ben" panelinde durum; reddedildiyse ayarlara götürür.
- **Anahtarlar**: Firebase hizmet hesabı anahtarını proje sahibi sunucuya kendisi yükler
  (`bargu-set-push`, önce Google'da denenir); uygulamanın `google-services.json` dosyası EAS dosya
  değişkeni (`GOOGLE_SERVICES_JSON`), depoda yok.

## Sonuçlar

- Firebase hesabı yokken her şey çalışır: bildirim kuyruğa bile girmez, uygulama içi bildirimler
  sürer ("Ben" panelinde "Bu sürümde henüz yok").
- Google bildirimlerin zamanını ve türünü görür (THREAT_MODEL). Faz 7'de konum bildirimleri
  sealed box ile gelecek; sosyal bildirimler de istenirse aynı yola taşınabilir.
- iOS (APNs) Apple hesabı gelince eklenecek; sunucu tarafı tür ve metin olarak hazır.
