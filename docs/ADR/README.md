# Mimari Karar Kayıtları (ADR)

Mimariyi değiştiren her karar bir ADR olarak yazılır (CLAUDE.md). Aşağıdaki şablonu
`NNNN-kisa-baslik.md` olarak kopyala. Kabul edilmiş bir ADR yeniden yazılmaz; yerine yenisi yazılır
ve eskisi "yerini aldı" olarak işaretlenir.

| #                                                    | Başlık                                                                                        | Durum                         |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------- |
| [0001](0001-toolchain-baseline.md)                   | Araç zinciri (Node, pnpm, TypeScript, ESLint, Expo)                                           | Kabul edildi                  |
| [0002](0002-backend-foundations.md)                  | Backend temeli (NestJS 12 ESM + Fastify, pg, node-redis)                                      | Kabul edildi                  |
| [0003](0003-staging-deployment.md)                   | Staging dağıtımı (paylaşımlı VPS, host nginx, GHCR, kısıtlı SSH)                              | Kabul edildi                  |
| [0004](0004-e2ee-protocol.md)                        | Uçtan uca şifreleme protokolü v1                                                              | Kabul edildi                  |
| [0005](0005-auth-and-devices.md)                     | Giriş, cihazlar ve satır bazlı yetki                                                          | Kabul edildi                  |
| [0006](0006-jobs-and-notifications.md)               | İş kuyruğu (pg-boss) ve bildirim altyapısı                                                    | Kabul edildi                  |
| [0007](0007-native-curve-primitives.md)              | Telefonda yerel eğri işlemleri (CryptoKit / Tink)                                             | Kabul edildi                  |
| [0008](0008-design-system-and-map.md)                | Tasarım sistemi, kendi sunucumuzda harita, profil ve ekran akışı                              | Kabul edildi                  |
| [0009](0009-circles-keys-and-events.md)              | Çemberler, davetler, anahtar dağıtımı ve canlı olaylar                                        | Kabul edildi                  |
| [0010](0010-early-push-notifications.md)             | Sistem bildirimleri: erken, içeriksiz, aracısız FCM                                           | Yerini 0016 aldı              |
| [0011](0011-location-engine-and-relay.md)            | Konum motoru ve şifreli konum aktarıcısı                                                      | Kabul edildi                  |
| [0012](0012-four-digit-login-code.md)                | Dört haneli giriş kodu ve sıkı deneme bütçeleri                                               | Kabul edildi                  |
| [0013](0013-weather-without-location.md)             | Konumu vermeden hava durumu, haritada Skia efektleri                                          | Kabul edildi                  |
| [0014](0014-encrypted-profile-photos.md)             | Uçtan uca şifreli profil fotoğrafı                                                            | Kabul edildi                  |
| [0015](0015-encrypted-places-and-arrivals.md)        | Şifreli yerler; varış ve ayrılışı telefon algılar                                             | Kabul edildi                  |
| [0016](0016-sealed-push-notifications.md)            | Bildirimler uçtan uca şifreli (ADR 0010'un yerine)                                            | Kabul edildi                  |
| [0017](0017-event-circles.md)                        | Etkinlik çemberleri: süreli, QR ile katılım, bitince iz kalmaz                                | Kabul edildi                  |
| [0018](0018-event-planning.md)                       | Etkinlik planlama: buluşma, oylama, varış tahmini, geç kalma                                  | Kabul edildi (yetkiler: 0020) |
| [0019](0019-location-history.md)                     | Çember geçmişi: uçtan uca şifreli, kapalı başlar, 14 gün                                      | Kabul edildi                  |
| [0020](0020-circle-admins-and-planning-authority.md) | Çember yöneticileri ve planlama yetkisi                                                       | Kabul edildi                  |
| [0021](0021-safety-features.md)                      | Güvenlik özellikleri: hatırlatma, yeni izleyici, tümünü durdur, kilit, olaylar, uzaktan iptal | Kabul edildi                  |

## Şablon

```md
# NNNN. Başlık

- Durum: Önerildi | Kabul edildi | Yerini aldı: NNNN
- Tarih: YYYY-AA-GG

## Bağlam

## Karar

## Sonuçlar
```
