# 0033. Anlık hikaye: 24 saatlik, uçtan uca şifreli fotoğraf

- Durum: Taslak (proje sahibinin isteği, 2026-10-23; PM ve hukuk/Play kontrolü bekliyor)
- Tarih: 2026-10-23
- İlgili: [ADR 0032](0032-messaging.md) (bildir ve engelle aynı), [ADR 0023](0023-age-15-plus.md),
  [PROTOCOL §6](../PROTOCOL.md).

## Bağlam

Sahip: "anlık hikaye paylaşım özelliği de gelsin". Fotoğrafı sunucu ve depolama da görmemeli.
Fotoğraflar konum bilgisi taşımamalı (EXIF'teki GPS).

## Önerilen karar

### 1. Hikaye = şifreli fotoğraf + kısa yazı, seçilen çemberlere, 24 saat

Telefonda sıra şöyle:

1. Fotoğraf kameradan ya da galeriden alınır.
2. En çok 1080 piksele küçültülür.
3. **EXIF tamamen silinir** (GPS dahil).
4. JPEG'e çevrilir.
5. Rastgele bir anahtarla (AES-256-GCM, noble) şifrelenir.
6. Şifreli dosya sunucuya yüklenir. Sunucu yalnız bayt görür; en çok 1,5 MB kabul eder.

Anahtar ve dosyanın kimliği, seçilen her çembere bir `story` mesajıyla gider (sender key, PROTOCOL
§5): `{ id, blobId, key, nonce, caption?, w, h, ts }`.

### 2. Sunucu

- Yeni tablo `app.stories(circle_id, id, sender_id, blob_id, envelope, ends_at)`.
- Dosyalar `/srv/bargu-media`'da, adı tahmin edilemez.
- Yalnız çemberin üyeleri indirebilir (yetki kontrolü).
- 24 saat sonra bir işçi satırı ve dosyayı siler. Silen gönderen de olabilir.
- Sınır: kişi başına günde 30 hikaye.

### 3. Telefonda

- Haritadaki ve listedeki avatarın çevresinde renkli bir halka çıkar ("yeni hikaye var").
- Dokununca tam ekran gösterilir: ilerleme çubuğu, kaydırınca sonraki.
- Çözülen fotoğraf yalnız bellekte ve geçici önbellekte tutulur; 24 saat sonra silinir.
- "Kim gördü": bakan telefon gönderene şifreli `story_seen` mesajı yollar; bu ayarda kapatılabilir.

### 4. Yeni bağımlılıklar (önce gerekçe ve bakım durumu)

- `expo-image-picker` (kamera ve galeri) ve `expo-image-manipulator` (küçültme, EXIF silme).
  İkisi de Expo'nun kendi paketleri, `npx expo install` ile kurulur.
- Kamera izni: Play izin listesine ve veri güvenliği formuna eklenir (docs/play-store).

### 5. Güvenlik ve Play şartları

Bildirme, engelleme, topluluk kuralları ve çocuk güvenliği ADR 0032 §5 ile aynı.

## Aşamalar

1. C1, sunucu: medya deposu, yükleme ve indirme uç noktaları, 24 saat işçisi, disk kotası, testler.
2. C2, mobil: çekim, küçültme ve EXIF silme, şifreleme, yükleme; avatar halkası, görüntüleyici,
   "kim gördü".

## Açık sorular (PM, sahip)

- Video (kısa, 15 sn) v1'de mi, sonra mı? Önerim sonra: boyut ve disk maliyeti.
- Staging sunucusunun diski paylaşımlı (rastamen de orada): kota ve izleme gerekir.
