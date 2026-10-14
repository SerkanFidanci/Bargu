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

| Saldırgan                             | Önlem                                                                                                                                                                                                                                                                                                           | Durum                                                                             |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Meraklı veya ele geçirilmiş sunucu    | E2EE (§4–5); sunucu düz koordinat görmez; log'larda konum/token/email yok                                                                                                                                                                                                                                       | ✅ Faz 0–1                                                                        |
| Sunucunun anahtar değiştirmesi (MITM) | DH anahtarı kimlikle imzalı; kimlik anahtarı güvenlik numarası / QR ile doğrulanır; anahtar değişince uyarı                                                                                                                                                                                                     | ✅ Kripto (Faz 1), UI Faz 4                                                       |
| Sahte veya değiştirilmiş mesaj        | Her zarf ve dağıtım Ed25519 imzalı; başlık AEAD'e bağlı; tek bit değişikliği reddedilir                                                                                                                                                                                                                         | ✅ Faz 1                                                                          |
| Tekrar (replay) saldırısı             | `(çember, gönderen)` başına kayan pencere + epoch tabanı; doğrulanamayan mesaj pencereyi ilerletmez                                                                                                                                                                                                             | ✅ Faz 1                                                                          |
| Çıkarılan üye                         | Rekey: yeni epoch yalnızca kalan üyelere dağıtılır                                                                                                                                                                                                                                                              | ✅ Kripto, akış Faz 4                                                             |
| Kontrolcü partner / aile üyesi        | Gizli paylaşım imkansız; yeni izleyici bildirimi; periyodik hatırlatma; tek dokunuşla durdurma; "Görenler" her an ekranda; çember başına kapatma, hassasiyet ve süre; hayalet modu (dondur / gizle); Android'de paylaşım açıkken kalıcı bildirim                                                                | "Görenler" ✅ Faz 3; durdurma, hayalet, süre, bildirim ✅ Faz 5; hatırlatma Faz 9 |
| Çalınan telefon                       | Anahtarlar Keychain/Keystore'da; opsiyonel biyometrik kilit; yeni cihazla giriş eskisini ve tüm oturumlarını anında iptal eder; email OTP ile uzaktan iptal → rekey                                                                                                                                             | İptal ✅ Faz 2; kilit ve uzaktan iptal Faz 9                                      |
| Telefondaki konum verisi              | Arkadaşların yalnızca en son konumu, şifreli kasada (MMKV AES-256, anahtarı Keystore/Keychain'de); geçmiş tutulmaz; çıkışta kasa ve anahtarı silinir                                                                                                                                                            | ✅ Faz 5                                                                          |
| Ağ saldırganı                         | TLS 1.3 (staging'de zorunlu), SPKI pinning, durum değiştiren her istek cihaz anahtarıyla imzalı ve tek kullanımlık (nonce)                                                                                                                                                                                      | TLS ✅; imza ✅ Faz 2; pinning Faz 10                                             |
| Bot / sahte istemci                   | App Attest + Play Integrity (cihaz anahtarına bağlı), production'da zorunlu; adres ve IP başına hız sınırı                                                                                                                                                                                                      | Kod ✅ Faz 2; gerçek cihazla deneme mağaza hesapları açılınca                     |
| Çalınan erişim / refresh token        | Erişim token'ı 10 dk ve her istekte cihaz/oturum kontrolü; refresh token cihaz imzası olmadan kullanılamaz; dönmüş token tekrar kullanılırsa tüm oturum ailesi iptal                                                                                                                                            | ✅ Faz 2                                                                          |
| Kod tahmini / hesap avı               | 4 haneli kod (ADR 0012), isteyen cihaza bağlı; 3 yanlışta kod ölür; (adres, cihaz) saatte 5, adres günde 10 ve haftada 20 yanlış; hak kod karşılaştırılmadan önce ayrılır; istemci ağı (IPv4 / IPv6 /64) sınırları; yanıt hesap olsa da olmasa da aynı; ele geçen hesap arkadaşların onayı olmadan konum alamaz | ✅ Faz 2, sıkılaştırma Faz 6                                                      |
| Veritabanı sızıntısı                  | E-posta adresi yok (anahtarlı özet), giriş kodu yok (türetilir), token'lar özet olarak; RLS + sahipsiz uygulama rolü; kuyruktaki adres şifreli                                                                                                                                                                  | ✅ Faz 2                                                                          |
| Tedarik zinciri                       | Kilitli lockfile, 24 saat / 7 gün yayın karantinası, yayın kanıtı düşüş engeli, install script izin listesi, gitleaks, Semgrep, CodeQL, audit, SHA sabitleme                                                                                                                                                    | ✅ Faz 0                                                                          |
| Harita / adres sağlayıcısı            | Karo, yazı tipi ve simgeler kendi sunucumuzda (görüntülenen bölge = konum); stilde başka adres olmadığı testle zorunlu; adres çözme (geocoding) cihazda / self-host                                                                                                                                             | Harita ✅ Faz 3; geocoding Faz 6                                                  |
| Hava durumu servisi                   | Servise yalnızca sabit Türkiye ızgarası gider (140 nokta); telefon herkese aynı dosyayı indirip kendi hücresini yerelde bulur (ADR 0013)                                                                                                                                                                        | ✅ Faz 6                                                                          |
| Bildirim servisleri (Google, Apple)   | Her bildirim tek cihaza mühürlü kutu; üyenin bildirimi imzalı (alıcıya bağlı), sunucunun haberi yalnızca tür + çember; FCM data-only, APNs içeriksiz yer tutucu; metni telefon yazar (ADR 0016)                                                                                                                 | ✅ Faz 7 (iOS cihazda deneme Apple hesabıyla)                                     |
| Sahte "eve vardı" (sunucu)            | Varış bildirimi gönderen cihazın kimlik anahtarıyla imzalı; telefon yalnızca güvendiği cihazı kabul eder; sunucu yalnızca `notice` gönderebilir                                                                                                                                                                 | ✅ Faz 7                                                                          |
| Yerlerin sızması / geri alınması      | Yer adı, konumu, yarıçapı şifreli (gönderen anahtarı); yalnızca aktif üyeler okur (RLS); güncel epoch zorunlu; `ts` yalnızca büyür, silinen yer geri gelmez (ADR 0015)                                                                                                                                          | ✅ Faz 7                                                                          |
| Zayıf rastgelelik                     | Yalnızca işletim sistemi CSPRNG'si; yoksa hata (güvensiz yedek yok)                                                                                                                                                                                                                                             | ✅ Faz 1                                                                          |

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

| Sızıntı                         | Ne ortaya çıkar                                                         | Azaltma                                                                                 |
| ------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Çember üyelikleri               | Sosyal graf                                                             | v2: MLS / sealed sender değerlendirmesi                                                 |
| Gönderim zamanları ve sıklığı   | Hareket ediyor mu, durağan mı, canlı modda mı                           | Sabit hızlı sahte trafik pil maliyeti yüzünden yok                                      |
| Zarf boyutu                     | —                                                                       | Tüm mesajlar tek boy (512 bayt dolgu)                                                   |
| "İzle" olayları (canlı mod)     | Kim kimin haritasını açtı                                               | —                                                                                       |
| Konumu geri çekme               | Bir çemberle paylaşımın durduğu an                                      | Neden (kapatma, süre, hayalet) görünmez; hassasiyet ve süre ayarları yalnızca telefonda |
| IP adresleri                    | Yaklaşık konum (ağ seviyesi)                                            | Log'lanmaz; kullanıcı VPN kullanabilir                                                  |
| Kullanıcı adının varlığı        | Bir adın kayıtlı olduğu                                                 | Ad zaten bulunmak için; hesap başına saatlik sınır                                      |
| Görünen ad ve avatar (sunucuda) | Ad, renk ve emoji; fotoğrafın var olduğu, boyutu ve değişme zamanı      | Fotoğraf uçtan uca şifreli (ADR 0014); şifreli profil (ad) ileriki faz                  |
| Çember adları                   | Ailenin / grubun adı                                                    | Davetli anahtar almadan önce görmeli (ADR 0009)                                         |
| Olay zamanları (canlı kanal)    | Çember değişikliklerinin ne zaman olduğu                                | İçerik yok; yalnızca tür ve çember kimliği                                              |
| Üye kimlikleri (UUIDv7)         | Hesabın yaklaşık açılış zamanı                                          | Yalnızca aynı çemberdekiler görür; davetli yalnızca daveti göndereni                    |
| Arkadaş QR / davet linki        | Linki ilk kullanan arkadaş olur                                         | 24 saat, tek kullanım; QR ekranında ekran görüntüsü engeli                              |
| Bildirim zamanlaması (APNs/FCM) | Bildirim gittiği an ve kutunun boyutu                                   | İçerik ve gönderen mühürlü (ADR 0016); kutu 128 baytlık bloklara dolgulu                |
| Yerler (sunucuda)               | Bir çemberde kaç yer olduğu, ne zaman değiştiği, kimin kaydettiği       | Ad, konum, yarıçap şifreli (ADR 0015)                                                   |
| Varış / ayrılış olayları        | Bir üyenin bir yere girdiği ya da çıktığı an (hangisi, hangi yer değil) | Yalnızca tam konum paylaşılan çembere gider; sunucu saklamaz                            |

## Gözden geçirme

Tehdit modeli şu durumlarda güncellenir: her faz sonunda, protokol sürümü değişince, yeni bir dış
servis eklenince. Bağımsız pentest ve OWASP MASVS L2 / ASVS L2 kontrolü Faz 10'da.
