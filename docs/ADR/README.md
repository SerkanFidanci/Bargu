# Mimari Karar Kayıtları (ADR)

Mimariyi değiştiren her karar bir ADR olarak yazılır (CLAUDE.md). Aşağıdaki şablonu
`NNNN-kisa-baslik.md` olarak kopyala. Kabul edilmiş bir ADR yeniden yazılmaz; yerine yenisi yazılır
ve eskisi "yerini aldı" olarak işaretlenir.

| #                                                    | Başlık                                                                                                                         | Durum                                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| [0001](0001-toolchain-baseline.md)                   | Araç zinciri (Node, pnpm, TypeScript, ESLint, Expo)                                                                            | Kabul edildi                                                         |
| [0002](0002-backend-foundations.md)                  | Backend temeli (NestJS 12 ESM + Fastify, pg, node-redis)                                                                       | Kabul edildi                                                         |
| [0003](0003-staging-deployment.md)                   | Staging dağıtımı (paylaşımlı VPS, host nginx, GHCR, kısıtlı SSH)                                                               | Kabul edildi                                                         |
| [0004](0004-e2ee-protocol.md)                        | Uçtan uca şifreleme protokolü v1                                                                                               | Kabul edildi                                                         |
| [0005](0005-auth-and-devices.md)                     | Giriş, cihazlar ve satır bazlı yetki                                                                                           | Kabul edildi                                                         |
| [0006](0006-jobs-and-notifications.md)               | İş kuyruğu (pg-boss) ve bildirim altyapısı                                                                                     | Kabul edildi                                                         |
| [0007](0007-native-curve-primitives.md)              | Telefonda yerel eğri işlemleri (CryptoKit / Tink)                                                                              | Kabul edildi                                                         |
| [0008](0008-design-system-and-map.md)                | Tasarım sistemi, kendi sunucumuzda harita, profil ve ekran akışı                                                               | Kabul edildi; Ek 2026-10-29 (lacivert ve turuncu, PM)                |
| [0009](0009-circles-keys-and-events.md)              | Çemberler, davetler, anahtar dağıtımı ve canlı olaylar                                                                         | Kabul edildi                                                         |
| [0010](0010-early-push-notifications.md)             | Sistem bildirimleri: erken, içeriksiz, aracısız FCM                                                                            | Yerini 0016 aldı                                                     |
| [0011](0011-location-engine-and-relay.md)            | Konum motoru ve şifreli konum aktarıcısı                                                                                       | Kabul edildi                                                         |
| [0012](0012-four-digit-login-code.md)                | Dört haneli giriş kodu ve sıkı deneme bütçeleri                                                                                | Kabul edildi                                                         |
| [0013](0013-weather-without-location.md)             | Konumu vermeden hava durumu, haritada Skia efektleri                                                                           | Kabul edildi                                                         |
| [0014](0014-encrypted-profile-photos.md)             | Uçtan uca şifreli profil fotoğrafı                                                                                             | Kabul edildi                                                         |
| [0015](0015-encrypted-places-and-arrivals.md)        | Şifreli yerler; varış ve ayrılışı telefon algılar                                                                              | Kabul edildi                                                         |
| [0016](0016-sealed-push-notifications.md)            | Bildirimler uçtan uca şifreli (ADR 0010'un yerine)                                                                             | Kabul edildi                                                         |
| [0017](0017-event-circles.md)                        | Etkinlik çemberleri: süreli, QR ile katılım, bitince iz kalmaz                                                                 | Kabul edildi                                                         |
| [0018](0018-event-planning.md)                       | Etkinlik planlama: buluşma, oylama, varış tahmini, geç kalma                                                                   | Kabul edildi (yetkiler: 0020)                                        |
| [0019](0019-location-history.md)                     | Çember geçmişi: uçtan uca şifreli, kapalı başlar, 14 gün                                                                       | Kabul edildi                                                         |
| [0020](0020-circle-admins-and-planning-authority.md) | Çember yöneticileri ve planlama yetkisi                                                                                        | Kabul edildi                                                         |
| [0021](0021-safety-features.md)                      | Güvenlik özellikleri: hatırlatma, yeni izleyici, tümünü durdur, kilit, olaylar, uzaktan iptal                                  | Kabul edildi                                                         |
| [0022](0022-account-deletion-export-consent.md)      | Hesap silme, veri dışa aktarma, KVKK aydınlatma ve rıza, yayın sayfaları                                                       | Kabul edildi                                                         |
| [0023](0023-age-15-plus.md)                          | Yaş sınırı 15+: beyan, e-Devlet yaş belirteci, 15–17 kuralları, ebeveyn araçları                                               | Kabul edildi                                                         |
| [0024](0024-entitlements-and-test-billing.md)        | Para modeli: hesap bazlı hak, çemberin ödeyeni, deneme, duraklama, sahte ödeme                                                 | Kabul edildi                                                         |
| [0025](0025-cosmetic-pass-and-look.md)               | Süs geçiş belgesi ve görünüm mesajı                                                                                            | Kabul edildi                                                         |
| [0026](0026-meetings-in-any-circle.md)               | Her çemberde buluşma, kendi görünümü ve ekranı, harita kısayolları ve sayaç                                                    | Kabul edildi                                                         |
| [0027](0027-calm-mode-and-motion-budget.md)          | Sade mod ve animasyon bütçesi (pil, görünmeyen harita, hava)                                                                   | Kabul edildi                                                         |
| [0028](0028-location-accuracy-and-glide.md)          | Konumun doğruluğu: ham konuma filtre, 1 sn sınırlı kayma, belirsizlik dairesi, ölçüm katmanı                                   | Kabul edildi (1. adım)                                               |
| [0029](0029-safe-check-in.md)                        | Güvendeyim: tek dokunuşla iyiyim, konum ve pil; hep bedava, duraklamış çemberde de çalışır                                     | Kabul edildi                                                         |
| [0030](0030-own-location-history.md)                 | Kendi konum geçmişi: yalnız telefonda, kapalı başlar, ek GPS yok                                                               | Önerildi (tasarım PM onaylı; kod sahibin telefon denemesinden sonra) |
| [0031](0031-expressive-pokes.md)                     | İfadeli dürtmeler: öp, sarıl, kız, gül, heyecan; "nerdesin?", "ne zaman?", "cevap ver"; dürtülenin ekranında animasyon         | Kabul edildi (sahibin isteği)                                        |
| [0032](0032-messaging.md)                            | Mesajlaşma: çemberde uçtan uca şifreli yazışma, sunucuda 30 gün şifreli kutu                                                   | Yerine geçti: 0035                                                   |
| [0033](0033-stories.md)                              | Anlık hikaye: 24 saatlik, uçtan uca şifreli fotoğraf, EXIF silinir                                                             | Yerine geçti: 0035                                                   |
| [0034](0034-domain-and-closed-test-server.md)        | Kalıcı alan adı bargu.app (davet ve RP ID kökte, API alt alanda); kapalı test bugünkü sunucuda, şifreli yedekle; sonra Türkiye | Kabul edildi                                                         |
| [0035](0035-messages-and-moments.md)                 | Mesajlar ve anlık fotoğraf: tek modül, 24 saat, uçtan uca şifreli; Bildir ve Engelle                                           | Kabul edildi (PM, 2026-10-27); Ek 1 kabul (PM, 2026-10-29)           |
| [0036](0036-battery-background-location.md)          | Pil: uygulama kapalıyken konum; GPS 30 sn, kapalıyken dakikada bir toplu teslim, bakılınca canlı                               | Kabul edildi (PM, 2026-10-29)                                        |

## Şablon

```md
# NNNN. Başlık

- Durum: Önerildi | Kabul edildi | Yerini aldı: NNNN
- Tarih: YYYY-AA-GG

## Bağlam

## Karar

## Sonuçlar
```
