# 0014. Uçtan uca şifreli profil fotoğrafı

- Durum: Kabul edildi
- Tarih: 2026-10-14

## Bağlam

Proje sahibi emoji avatar yerine isteğe bağlı profil fotoğrafı istedi. Önceki kararlarda fotoğraf
yoktu (THREAT_MODEL: "fotoğraf yok; şifreli profil ileriki faz"), çünkü düz bir fotoğraf sunucuda
yüz, yer ve kimlik bilgisi demektir.

## Karar

- **Fotoğraf telefonda şifrelenir**: galeriden seçilir, sistem düzenleyicisinde kare kırpılır,
  256 px'e küçültülür ve en çok 40 KB JPEG olur. Her yeni fotoğraf için rastgele 32 baytlık anahtar;
  XChaCha20-Poly1305, fotoğraf kimliği ek doğrulanmış veri (sunucu bir fotoğrafı başkasınınki
  gibi gösteremez). `packages/crypto` `sealProfilePhoto` / `openProfilePhoto`.
- **Anahtar çemberlere şifreli gider**: yeni mesaj türü `profile` (fotoğraf kimliği + anahtar ya
  da "fotoğraf yok"), konum ve durum gibi gönderen anahtarıyla her çember için ayrı şifrelenir;
  aktarıcı her üyenin son profil mesajını 30 gün tutar. Telefon yeni çemberlere ve her yeni
  epoch'a mesajı yeniden gönderir (yeni üye eskisini açamaz).
- **Sunucu yalnızca şifreli dosyayı tutar**: `app.profile_photos` (zorunlu RLS): sahibi yazar ve
  siler; yalnızca sahibiyle aktif bir çemberi paylaşan okuyabilir; diğerine "yok" (404).
  `PUT/DELETE /v1/me/photo`, `GET /v1/users/:id/photo`.
- **Telefonda**: açılan fotoğraf şifreli kasada saklanır, avatarlar (harita, kart, listeler)
  kişinin kimliğiyle fotoğrafı bulur; fotoğraf yoksa emoji. "Fotoğrafı kaldır" emojiye döner.
- **İzinler**: yalnızca galeri (Android 13+ sistem fotoğraf seçicisi izinsiz). Kütüphanenin
  eklediği mikrofon izni açıkça engellendi (`blockedPermissions`).
- Bağımlılıklar: `expo-image-picker` 57.0.20, `expo-image-manipulator` 57.0.21 (Expo'nun kendi
  paketleri, SDK 57 sürümleri).

## Sonuçlar

- Sunucu kimin fotoğrafı olduğunu, boyutunu ve ne zaman değiştiğini görür; içeriğini göremez.
- Çemberden çıkan biri o andan sonra fotoğrafı indiremez; daha önce açtığı kopya kendi
  telefonunda kalır (her paylaşımın doğası).
- Fotoğrafın ilk kez görünmesi için arkadaşın uygulamasının açık olup profil mesajını alması
  gerekir (canlı ya da bağlanınca).
- Yeni telefona geçişte fotoğraf anahtarı taşınmaz; kullanıcı fotoğrafı yeniden seçer.
