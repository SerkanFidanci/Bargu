# Tehdit Modeli

Özet BARGU_PLAN §2'de; bu belge ayrıntıları, uygulanan önlemleri ve bilinçli olarak kabul edilen
sızıntıları tutar. Protokol: [PROTOCOL.md](PROTOCOL.md). Her faz sonunda güncellenir.

## Varlıklar

| Varlık                         | Neden değerli                                |
| ------------------------------ | -------------------------------------------- |
| Konum (anlık ve geçmiş)        | Fiziksel güvenlik; takip, taciz              |
| Sosyal graf (kim kiminle)      | İlişkiler, aile yapısı                       |
| Cihaz kimlik ve DH anahtarları | Ele geçerse kimlik taklidi ve şifre çözme    |
| Sender key'ler                 | Bir epoch'taki bütün çember mesajlarını açar |
| Oturum token'ları              | Hesap ele geçirme                            |

## Güven sınırları

- **Güvenilen:** kullanıcının kendi cihazı (kilit açıkken) ve üzerindeki uygulama kodu.
- **İçerik için güvenilmeyen:** Bargu sunucusu ve yöneticileri, push sağlayıcıları (APNs, FCM), ağ,
  harita ve adres sağlayıcıları. Sunucu yalnızca şifreli zarf ve açık anahtar görür.

## Saldırganlar ve önlemler

| Saldırgan                             | Önlem                                                                                                                                                        | Durum                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| Meraklı veya ele geçirilmiş sunucu    | E2EE (§4–5); sunucu düz koordinat görmez; log'larda konum/token/email yok                                                                                    | ✅ Faz 0–1                  |
| Sunucunun anahtar değiştirmesi (MITM) | DH anahtarı kimlikle imzalı; kimlik anahtarı güvenlik numarası / QR ile doğrulanır; anahtar değişince uyarı                                                  | ✅ Kripto (Faz 1), UI Faz 4 |
| Sahte veya değiştirilmiş mesaj        | Her zarf ve dağıtım Ed25519 imzalı; başlık AEAD'e bağlı; tek bit değişikliği reddedilir                                                                      | ✅ Faz 1                    |
| Tekrar (replay) saldırısı             | `(çember, gönderen)` başına kayan pencere + epoch tabanı; doğrulanamayan mesaj pencereyi ilerletmez                                                          | ✅ Faz 1                    |
| Çıkarılan üye                         | Rekey: yeni epoch yalnızca kalan üyelere dağıtılır                                                                                                           | ✅ Kripto, akış Faz 4       |
| Kontrolcü partner / aile üyesi        | Gizli paylaşım imkansız; yeni izleyici bildirimi; periyodik hatırlatma; tek dokunuşla durdurma; "Görenler" her an ekranda                                    | Faz 3, 5, 9                 |
| Çalınan telefon                       | Anahtarlar Keychain/Keystore'da; opsiyonel biyometrik kilit; email OTP ile uzaktan iptal → rekey                                                             | Faz 2, 9                    |
| Ağ saldırganı                         | TLS 1.3 (staging'de zorunlu), SPKI pinning, istek imzalama                                                                                                   | TLS ✅; pinning Faz 10      |
| Bot / sahte istemci                   | App Attest + Play Integrity, rate limit                                                                                                                      | Faz 2                       |
| Tedarik zinciri                       | Kilitli lockfile, 24 saat / 7 gün yayın karantinası, yayın kanıtı düşüş engeli, install script izin listesi, gitleaks, Semgrep, CodeQL, audit, SHA sabitleme | ✅ Faz 0                    |
| Harita / adres sağlayıcısı            | Self-host tile ve geocoding (görüntülenen bölge = konum)                                                                                                     | Faz 3                       |
| Zayıf rastgelelik                     | Yalnızca işletim sistemi CSPRNG'si; yoksa hata (güvensiz yedek yok)                                                                                          | ✅ Faz 1                    |

## Kriptografik sınırlar (bilinçli tercihler)

- **Epoch içinde ileri gizlilik yok.** Bir cihaz ele geçerse, elindeki sender key'lerle **o epoch'un**
  mesajları açılabilir. Epoch en geç 24 saatte bir yenilenir; sunucu konumu yalnızca 24 saat (Redis
  TTL) tutar. Mesaj başına ratchet (Signal tarzı) paket kaybına dayanıklılık ve O(1) hedefleriyle
  çelişir; MLS (RFC 9420) v2'de değerlendirilecek.
- **İnkâr edilebilirlik yok.** Mesajlar Ed25519 ile imzalı olduğu için alıcı, mesajı kimin gönderdiğini
  üçüncü kişiye kanıtlayabilir. Konum paylaşımında, kimliği doğrulanmış kaynak bu özellikten daha
  önemli kabul edildi.
- **JavaScript'te sabit zaman garantisi yok.** noble kütüphaneleri sabit zamana yakın çalışmayı
  hedefler. Mobil tehdit modelinde yerel yan kanal saldırısı kapsam dışı.
- **Hesap başına tek cihaz.** Çoklu cihaz E2EE karmaşıklığı v2'ye bırakıldı.

## Kabul edilen sızıntılar (metadata)

Sunucu içerik görmez ama şunları görür; belgeleniyor ve kabul ediliyor:

| Sızıntı                         | Ne ortaya çıkar                               | Azaltma                                            |
| ------------------------------- | --------------------------------------------- | -------------------------------------------------- |
| Çember üyelikleri               | Sosyal graf                                   | v2: MLS / sealed sender değerlendirmesi            |
| Gönderim zamanları ve sıklığı   | Hareket ediyor mu, durağan mı, canlı modda mı | Sabit hızlı sahte trafik pil maliyeti yüzünden yok |
| Zarf boyutu                     | —                                             | Tüm mesajlar tek boy (512 bayt dolgu)              |
| "İzle" olayları (canlı mod)     | Kim kimin haritasını açtı                     | —                                                  |
| IP adresleri                    | Yaklaşık konum (ağ seviyesi)                  | Log'lanmaz; kullanıcı VPN kullanabilir             |
| Bildirim zamanlaması (APNs/FCM) | Olayların zamanı                              | İçerik sealed box ile gizli                        |

## Gözden geçirme

Tehdit modeli şu durumlarda güncellenir: her faz sonunda, protokol sürümü değişince, yeni bir dış
servis eklenince. Bağımsız pentest ve OWASP MASVS L2 / ASVS L2 kontrolü Faz 10'da.
