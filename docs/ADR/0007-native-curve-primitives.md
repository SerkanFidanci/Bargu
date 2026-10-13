# 0007. Telefonda yerel eğri işlemleri (CryptoKit / Tink)

- Durum: Kabul edildi
- Tarih: 2026-10-13

## Bağlam

Faz 1 DoD'si "cihazda şifreleme < 5 ms" diyor. Android telefonda (Hermes) ölçüm: konum şifreleme p95
**6,7 ms**, doğrulama + çözme **15 ms**, anahtar dağıtımı 22 ms. Node'da aynı kod 0,46 ms. Sebep:
`@noble/curves` eğri aritmetiğini JavaScript BigInt ile yapıyor ve Hermes'te BigInt yavaş. Asıl yük
alıcıda: 20 arkadaş canlı modda saniyede bir konum gönderirse, yalnızca doğrulama JS iş parçacığının
üçte birini yer. Hash, HKDF ve ChaCha20-Poly1305 32 bit işlemlerle çalıştığı için sorun değil.

## Seçenekler

| Seçenek                               | Artı                                          | Eksi                                                                       |
| ------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------- |
| noble'da kalmak / önhesaplama         | Tek kod yolu                                  | Hedefin altına inmiyor; doğrulama en fazla birkaç kat hızlanır             |
| `react-native-quick-crypto` (OpenSSL) | Node API'si, yaygın                           | Üçüncü taraf OpenSSL ikilileri, Node polyfill'leri, büyük bağımlılık ağacı |
| `react-native-libsodium`              | libsodium                                     | npm paketinde hazır ikili arşiv + kurulum betiği, API'nin bir alt kümesi   |
| **Kendi ince Expo modülümüz**         | Apple CryptoKit (sistem), Google Tink (Maven) | Kendi native kodumuz (çok ince), iOS ancak Apple hesabıyla derlenebilir    |

## Karar

- `packages/crypto`, dört eğri işlemini (Ed25519 imza/doğrulama, X25519 açık anahtar/ortak sır)
  takılabilir yapar. Varsayılan ve sunucu/test yolu **noble** (referans) olarak kalır.
- Telefonda `apps/mobile/modules/bargu-native-crypto` bu dört işlemi sağlar: iOS'ta **CryptoKit**,
  Android'de **Google Tink 1.23** (`subtle.Ed25519Sign/Verify`, `subtle.X25519`). Kendi primitive'imiz
  yok; modül yalnızca platform kütüphanesini çağırır.
- **Öz test, sonra devreye alma**: açılışta yerel modül noble ile rastgele girdilerle karşılaştırılır:
  ürettiği imza referansta doğrulanmalı, referans imzayı kabul etmeli, değiştirilmiş mesajı/imzayı,
  başka anahtarı ve **S + L ile esnetilmiş** imzayı reddetmeli, X25519 sonuçları bayt bayt aynı
  olmalı. Herhangi bir uyumsuzluk veya hata → noble kalır. Yerel kod uygulamayı yalnızca
  hızlandırabilir, zayıflatamaz.
- Savunma kontrolleri her çağrıda: imza 64 bayt değilse hata, doğrulama hatası `false`, X25519 sıfır
  çıktısı reddedilir. Küçük mertebeli kimlik anahtarları, anahtar paketi doğrulamasında (noble)
  zaten reddediliyor (ADR 0004, Faz 1 incelemesi).
- CryptoKit Ed25519 imzaları rastgelelik içerir (yine RFC 8032 ile geçerli); protokol imzanın bayt
  eşitliğine dayanmaz. Fixture'lar ve Swift testleri değişmez.

## Sonuçlar

- Android'de yeni build gerekir (native modül). iOS tarafı, Apple Developer hesabı gelene kadar
  derlenemez; o güne kadar kodu yalnızca incelenmiş durumda.
- Tink APK'ya yaklaşık 1–3 MB ekler (R8 ile küçülür).
- Ölçüm yeni build'deki hız testi ekranından alınır; ekran hangi arka ucun çalıştığını da gösterir.
- Faz 7'de iOS bildirim eklentisi zaten CryptoKit kullanıyor (packages/crypto/swift); bu modül
  ileride aynı Swift paketini paylaşabilir.
