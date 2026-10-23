# 0032. Mesajlaşma: çemberde uçtan uca şifreli yazışma

- Durum: Taslak (proje sahibinin isteği, 2026-10-23; PM ve hukuk/Play kontrolü bekliyor)
- Tarih: 2026-10-23
- İlgili: [ADR 0016](0016-sealed-push-notifications.md), [ADR 0023](0023-age-15-plus.md) (15–17),
  [ADR 0031](0031-expressive-pokes.md), [PROTOCOL §4–§6, §9](../PROTOCOL.md).

## Bağlam

Sahip: "mesajlaşma ... özelliği de gelsin". Bargu'nun sözü "Zenly hissi, Signal güvenliği": yazışma
da uçtan uca şifreli olmalı; sunucu içerik görmemeli, sadece iletmeli ve kısa süre saklamalı.

## Önerilen karar

### 1. Her çemberin kendi sohbeti

- İkili çember bire bir sohbettir; aile ve grup çemberleri grup sohbetidir.
- Etkinlik çemberleri de sohbet alır, etkinlik bitince sohbet de gider.
- Yeni bir anahtar dağıtımı yok: mesajlar çemberin mevcut sender key'iyle şifrelenir ve imzalanır,
  konumla aynı zarfı kullanır (PROTOCOL §5).

### 2. Mesaj türleri (PROTOCOL §6)

- `msg { id, text (≤ 1000 karakter), replyTo?, ts }`
- `msg_del { id }`: kendi mesajını herkesten silme.
- `msg_seen { upTo }`: okundu bilgisi. İsteğe bağlı; ayarda kapatılabilir.

Yazıyor göstergesi yok (v1).

### 3. Sunucu: yalnız şifreli kutu, 30 gün

- Yeni tablo `app.circle_messages(circle_id, id, sender_id, envelope, created_at)`, yalnız üyeler
  okur (RLS).
- Uygulaması kapalı olan telefon sonradan çeker: `GET /v1/circles/:id/messages?after=`.
- 30 gün sonra bir işçi siler. Çemberden çıkan ya da hesabını silen kişinin mesajları gider.
- Canlı: `messages.new` olayı (soket). Kapalı uygulamaya mühürlü bildirim gider: "Ayşe: merhaba".
  Metni alan telefon yazar; kilit ekranında önizlemeyi gizleme ayarı olur.
- Sınır: çember başına dakikada 30 mesaj.

### 4. Telefonda saklama

- Şifreli kasada (MMKV) çember başına son 500 mesaj tutulur. Daha eskisi telefondan da silinir.
- Yeni bir veritabanı bağımlılığı eklenmez.
- Hesaptan çıkınca hepsi gider.

### 5. Güvenlik ve Play şartları (kod öncesi PM ve hukuk onayı)

- **Bildir:** bir mesajı ya da kişiyi bildirme. Kullanıcı mesajın açık metnini kendi isteğiyle
  operatöre gönderir (WhatsApp modeli).
- **Engelle:** kişiyi sessize alma ya da çemberden çıkarma, ayrıca "bu kişiden mesaj alma".
- Google Play'in kullanıcı içeriği (UGC) ve çocuk güvenliği (CSAE) politikası şunları ister:
  - bildirme ve engelleme;
  - yayımlanmış bir topluluk kuralları sayfası;
  - çocuk istismarına karşı açık bir standart ve bir iletişim noktası.
- 15–17 yaş (ADR 0023):
  - ebeveyni bağlı gençlere yetişkinle ilk sohbette uyarı;
  - ebeveyn bağlantısıyla mesajlaşmayı kapatma seçeneği.
- KVKK: içerik şifreli. Üst veri (kim, hangi çember, ne zaman) 30 gün tutulur; gizlilik metnine
  eklenir.

### 6. Aşamalar

1. B1, sunucu: tablo, uç noktalar, işçi, olay, bildirim, "başka kullanıcı erişemez" testleri.
2. B2, mobil: çemberin sohbet ekranı, çember listesinde okunmamış sayısı, kişi kartında "Mesaj".
3. B3: bildir ve engelle, topluluk kuralları sayfası, 15–17 kuralları.

## Açık sorular (PM, sahip)

- Saklama süresi 30 gün mü olsun, "okununca 7 gün" mü?
- Fotoğraf mesajı: v1'de yok; hikayeyle (ADR 0033) aynı medya yolunu kullanabilir.
- Bargu+ ile ilişkisi: önerim, mesajlaşma bedava olsun ("kuran öder" modelinde çember zaten
  ödenmiş).
