# 0025. Süs geçiş belgesi ve görünüm mesajı

- Durum: Kabul edildi (PM, 2026-10-16)
- Tarih: 2026-10-16
- İlgili: [ADR 0024 §7](0024-entitlements-and-test-billing.md) (süs hakları),
  [ADR 0014](0014-encrypted-profile-photos.md) (şifreli profil), [PROTOCOL](../PROTOCOL.md)

## Bağlam

Süs paketleri (Faz 9B dilim 3) yalnızca görünüştür, ama satın alınır. Arkadaşın telefonu bir süsü
göstermeden önce gerçekten alındığını doğrulamalıdır; değiştirilmiş bir uygulama bedava süs
gösterememelidir. Bunun yanında Bargu'nun kuralı geçerli: sunucu kişinin ne seçtiğini bilmemeli,
yalnızca hangi paketi aldığını bilir (hakkı o verir).

Bu, Bargu'da yeni bir imza mekanizmasıdır: şimdiye kadar yalnızca cihazlar imzalıyordu; bu kez
sunucu, telefonların doğrulayacağı bir belge imzalar. Bu yüzden ayrı bir ADR.

## Karar

### 1. Geçiş belgesi (cosmetic pass)

- Sunucu, hesabın aldığı süs paketlerini Ed25519 ile imzalı kısa bir belge olarak verir.
- Belgede yalnızca şunlar vardır: sürüm (`v: 1`), anahtar kimliği (`kid`), hesap kimliği,
  paket kimlikleri, veriliş ve bitiş zamanı, imza. Fiyat, satın alma tarihi, e-posta, kaynak
  (`test`, `play`) yoktur.
- İmzalanan baytlar sabit bir düzendedir (JSON değil), etiket `bargu/v1/cosmetic-pass`:
  `0x01 ‖ len(kid) ‖ kid ‖ userId(16) ‖ issuedAt(8, BE, ms) ‖ expiresAt(8, BE, ms) ‖ adet(1) ‖
her paket için len ‖ paket` (paketler sıralı ve tekil, en çok 6; kimlikler en çok 16 karakter).
  Sınır, görünüm mesajının en büyük hâlinin 512 bayta sığması içindir (test eder). Paket sayısı
  artınca telefon yalnızca kullandığı paketler için belge ister.
- Belge 30 gün geçerlidir. Telefon, `plan.changed` olayında ve uygulama açılırken süresinin
  yarısından azı kaldıysa yenisini ister.
- İmza ve doğrulama `packages/crypto`'dadır (`issueCosmeticPass`, `verifyCosmeticPass`).
- Uç: `GET /v1/me/cosmetics/pass`. Yalnızca çağıranın kendi belgesi; başka hesabın belgesi
  istenemez (hesap kimliği parametre değildir). Paketi yoksa `{ pass: null }`.
- Test kaynaklı süs paketleri belgeye yalnızca test satın almanın açık olduğu yerde girer (ADR 0024
  §6, P1b ile aynı kural).

### 2. Anahtarlar

- Sunucu sırrı `ENTITLEMENT_SIGNING_KEY` (32 bayt), kimliği `ENTITLEMENT_SIGNING_KID`. Yoksa
  belge ucu yoktur (404) ve süs gösterilmez.
- Staging ile üretimin anahtarı ayrıdır. Uygulama, derleme profiline göre güvendiği açık
  anahtarların listesini taşır (`EXPO_PUBLIC_COSMETIC_KEYS`, `kid:anahtar` virgülle):
  - preview derlemesi staging anahtarına güvenir;
  - üretim derlemesi yalnızca üretim anahtarına güvenir (üretim anahtarı ileride ayrı üretilir).
    Bu yüzden staging'de test satın almayla alınmış bir süs üretimde hiç görünmez (P1b'nin süs
    karşılığı).
- Birden çok anahtar tanınır: anahtar değiştirilirken eski ve yeni `kid` bir süre birlikte
  güvenilir, sonra eskisi listeden çıkar.
- Sır yalnızca sunucudaki Bargu ortam dosyasında durur; ekrana, loga ya da repoya yazılmaz.

### 3. Görünüm mesajı (`look`)

- Yeni şifreli mesaj türü `look`: seçilen ada deseni, seçilen çıkartma kenarı ve geçiş belgesi.
  Konum ve profil gibi gönderen anahtarıyla her çember için ayrı şifrelenir. Sunucu hangi deseni
  seçtiğini görmez.
- Profilin içine konmadı: en büyük profil mesajı (fotoğraf ve iki anahtar iadesi) 512 baytlık
  dolguyu zaten neredeyse dolduruyor. Ayrı tür, eski uygulamalarda da güvenlidir: tanımadıkları türü
  `MALFORMED` sayıp yok sayarlar (b85ac9d'deki test).
- Her mesaj gibi tam 512 bayta dolgulanır: boyu kaç paket alındığını göstermez.
- Profilin gittiği her durumda gider: yeni üye, yeni epoch, yeni cihaz, güven onayından (TOFU)
  sonra. Aktarıcı her üyenin son görünüm mesajını profil gibi 30 gün tutar (`look:{circleId}`,
  `POST/GET /v1/looks`, canlı bağlantıda `look`).
- Gören telefon şunlara bakar:
  - imza güvendiği bir anahtarla doğru mu, anahtar kimliği biliniyor mu;
  - belge süresi geçmemiş mi;
  - belge, mesajı gönderen hesabın mı;
  - seçilen desen ve kenar belgedeki bir pakete mi ait.
    Biri tutmazsa ya da mesaj hiç gelmezse varsayılan görünüm çıkar; hata gösterilmez.

### 4. Paketler

- "Ada desenleri" (`islands`, ₺29,99): çizgili, puantiyeli, renk geçişli, parıltılı.
- "Çıkartma kenarları" (`edges`, ₺29,99): holografik, altın, neon, kesik çizgi.
- Sezon paketleri, kostümler, efektler ve Bargu+'nın aylık hediye süsü sonraki dilimde.

### 5. Ekran ve çizim

- "Ben > Görünüm": kendi çıkartmanın üstünde önizleme, paket satın alma (test), seçim.
- Hareketli stiller (parıltılı, holografik, neon) Reanimated worklet'leriyle ve hareket
  tokenlarıyla çizilir. Sade modda, sistemin "Hareketi azalt" ayarında ve pil tasarrufunda durur.
- Haritada aynı anda yalnızca birkaç işaretçi hareketlidir (token ile sınırlı); pil davranışı
  geriye gitmez.
- Ad ve yaş yazısı her desende, açık ve koyu temada okunur kalır.

### 6. 15–17

- Süs satın alma da ebeveyn onayıyla (ADR 0024 §5, ürün `cosmetic:<paket>`). Süs istekleri Bargu+
  isteğinden ayrı tutulur; biri ötekini silmez. Ebeveyn ikisini de görür.

## Sonuçlar

- Sunucu hangi paketlerin alındığını bilir (hakkı verdiği için zaten biliyordu); hangi desenin
  seçildiğini bilmez.
- **Kabul edilen risk (PM):** İadeden sonra değiştirilmiş bir uygulama, elindeki en çok 30 günlük
  eski belgeyle süsü göstermeye devam edebilir. Belge süresi bunu sınırlar.
- Anahtarın sızması, sızan anahtarla bedava süs gösterilebilmesi demektir; işlev ya da güvenlik
  açısından bir şey açmaz (süs yalnızca görünüştür). Anahtar değiştirilir, eski `kid` uygulamadan
  çıkar.
- Eski uygulamalar `look` mesajını yok sayar; süsleri görmezler, bozulmazlar.
