# 0004. Uçtan uca şifreleme protokolü v1

- Durum: Kabul edildi
- Tarih: 2026-10-13

## Bağlam

BARGU_PLAN §3.1 protokolün iskeletini veriyor: X25519 / Ed25519 / HKDF-SHA256 / ChaCha20-Poly1305,
çember başına sender key, mesaj başına HKDF ile türetilen anahtar, `seq` ile tekrar koruması, grid
snap hassasiyeti, güvenlik numarası ve bildirim sealed box'ı. Uygulama sırasında plandaki tanımın bazı
yerlerinde güvenlik açısından netleştirme ya da sıkılaştırma gerekti.

## Karar

Protokol [PROTOCOL.md](../PROTOCOL.md)'deki gibi uygulandı. Plana göre farklar ve gerekçeleri:

1. **Etiketlerle alan ayrımı.** Her imza ve KDF bağlamı kendi etiketiyle başlar (`bargu/v1/…\0`).
   Plandaki `sig = Ed25519(header ‖ ct)` → `Ed25519(etiket ‖ header ‖ ct)`. Aynı kimlik anahtarı mesaj,
   dağıtım ve DH anahtarı imzalıyor; etiketler bir imzanın başka bir bağlamda geçerli sayılmasını önler.
2. **Mesaj başına rastgele `salt`** (16 bayt) başlıkta ve HKDF salt'ında. Plan anahtarı yalnızca
   `seq`'ten türetiyordu. Uygulama arka planda öldürülüp `seq`'i kaydedemezse aynı anahtar/nonce iki
   farklı konum için kullanılır; sunucu iki düz metnin XOR'unu görür. `salt` bu durumu imkânsız kılar.
   Zarfa 22 karakter ekler.
3. **DH anahtarı kimlik anahtarıyla imzalı** (`dhKeySignature`). Güvenlik numarası yalnızca kimlik
   anahtarlarını kapsar; imza olmasa sunucu DH anahtarını değiştirip sender key'leri kendine
   yönlendirebilirdi.
4. **Katı doğrulama:** Ed25519 `zip215: false`; küçük mertebeli kimlik anahtarları ve düşük mertebeli
   X25519 noktaları reddedilir; base64url kanonik olmalı.
5. **Dolgu:** mesaj içeriği her zaman tam 512 bayta tamamlanır (boyuttan içerik türü, hassasiyet
   seviyesi veya hareket bilgisi çıkmasın). İlk sürümdeki 128 baytlık bloklar bağımsız incelemede
   yetersiz bulundu (tam konum 256, mahalle/şehir 128 bayt oluyordu). Durum metninde kontrol, tek başına
   vekil (lone surrogate) ve yön değiştirme karakterleri yasak.
6. **Güvenlik numarası:** SHA-256'nın 5200 turluk tekrarı (Signal'in SHA-512 yapısının SHA-256 hali);
   sıralama tam parmak izi baytlarına göre (iki telefonda da aynı QR).
7. **Hassasiyet ızgarası:** satır ve sütunlar 180°/360°'yi tam bölecek şekilde ayarlanır; tarih
   değiştirme hattında yarım hücre ve idempotentlik hatası oluşmaz (property testi bu hatayı buldu).
8. **Kütüphaneler:** `@noble/curves`, `@noble/ciphers`, `@noble/hashes` 2.4.0 ve `@scure/base`
   2.4.0 (aynı yazar, audit edilmiş, saf TS). iOS tarafı CryptoKit; Linux'ta yerel test için aynı
   API'li `swift-crypto` 5.0.0.
9. **React Native rastgeleliği:** Hermes'te Web Crypto yok. `expo-crypto` işletim sisteminin CSPRNG'sini
   `crypto.getRandomValues` olarak kurar (`apps/mobile/src/platform/secure-random.ts`). Bu,
   "kripto kodu sadece packages/crypto'da" kuralının tek istisnası: kriptografi değil, platform
   yapıştırıcısı. Lint istisnası yalnızca bu dosyaya tanımlı.
10. **Sunucu doğrulaması:** `verifyMessageEnvelope` ve `verifySenderKeyDistribution` anahtarsız çalışır
    (imza + biçim). Üyelik kontrolü API'de yapılır (Faz 4–5).
11. **Tekrar koruması çember başına, kayan pencereli ve epoch tabanlı** (bağımsız inceleme bulgusu):
    ilk sürüm `(gönderen, epoch)` anahtarını kullanıyordu; epoch çember başına olduğundan bir
    çemberdeki yeni epoch diğer çemberin penceresini siliyor ve tekrar saldırısına kapı açıyordu.
    Artık `(çember, gönderen)` başına 64'lük kayan pencere (sırası karışan olaylar kaybolmaz), epoch
    tabanı (N − 2 ve öncesi ölü) ve konum için son-yazan-kazanır (`STALE`).
12. **Mahalle/şehir modunda `acc`** hücre yarıçapının tam katına yuvarlanır; ham GPS doğruluğu
    sızmaz.

## Sonuçlar

- Fixture dosyası protokolün kilidi: bayt düzeyinde bir değişiklik TS testini ve macOS'taki Swift
  testini kırar. Bilinçli değişiklik = yeni fixture + PROTOCOL.md güncellemesi.
- Epoch içinde ileri gizlilik ve inkâr edilebilirlik yok (THREAT_MODEL.md); MLS v2'de.
- `seq` gönderimden önce kalıcı olmalı; durum kaybı rekey gerektirir (`rekeyReason: 'state-lost'`).
