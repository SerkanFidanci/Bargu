# Siber Güvenlik Başkanlığı'na yazı: yaş doğrulama kılavuzu talebi (taslak)

- Durum: Taslak. Proje sahibi okuyup kendi adına gönderecek.
- Hazırlanma: 2026-10-15
- İlgili: ADR 0023

## Göndermeden önce

- **Kanal [doğrulanamadı]:** Başkanlığın yazılı başvuru için resmî adresi (KEP adresi, e-posta ya da
  iletişim formu) aramada bulunamadı.
  - Önce Başkanlığın resmî sitesindeki iletişim bölümüne bakılmalı.
  - Bulunamazsa başvuru CİMER (cimer.gov.tr) üzerinden "Siber Güvenlik Başkanlığı" seçilerek
    yapılabilir; metin aşağıdakiyle aynı kalır.
- **Köşeli parantezli yerler** proje sahibinin bilgileriyle doldurulur: ad, il ya da adres, e-posta,
  telefon (isteğe bağlı).
- **Gönderince:** Tarih ve kanal bu dosyaya ya da DURUM.md'ye yazılsın. Cevap gelirse ADR 0023'teki
  belirteç modülü ona göre yapılır.

---

T.C. Cumhurbaşkanlığı Siber Güvenlik Başkanlığı'na

**Konu:** Yaş doğrulama belirteci teknik kılavuzu ve sağlayıcı entegrasyonu hakkında bilgi talebi

Sayın Yetkili,

10 Ekim 2026 tarihli ve 33396 sayılı Resmî Gazete'de yayımlanan "Sosyal Ağ Sağlayıcı Tarafından
Çocuklara Özgü Ayrıştırılmış Hizmet Sunulmasına ve Yaş Doğrulamaya İlişkin Yönetmelik" kapsamında
yükümlülüklerimizi yerine getirmek amacıyla bilgi almak istiyorum.

Bireysel geliştirici olarak "Bargu" adlı bir mobil uygulama geliştiriyorum. Bargu, arkadaşların ve
ailelerin birbirleriyle canlı konumlarını uçtan uca şifreli olarak paylaştığı bir uygulamadır.
Herkese açık profil, mesajlaşma, canlı yayın, içerik akışı ya da reklam yoktur; kişiler yalnızca
birbirlerini karşılıklı onayla eklerler. Uygulama şu an kapalı test aşamasındadır ve henüz herkese
açık olarak yayımlanmamıştır. Hizmetin Yönetmelik kapsamında olduğunu kabul ederek hazırlık
yapıyorum:

- 15 yaşından küçüklerin hesap açması engellenmektedir.
- 15–18 yaş arası kullanıcılar için Yönetmeliğin 8 inci maddesindeki varsayılan ayarlar
  uygulanmaktadır.
- 9 uncu maddedeki ebeveyn denetim araçları geliştirilmektedir.

Yönetmeliğin 12 nci maddesinde yaş doğrulama belirtecinin yapısı, biçimi ve doğrulama sürecinin bir
teknik kılavuzla sağlayıcılara bildirileceği belirtilmektedir. Bu kapsamda aşağıdaki konularda bilgi
rica ediyorum:

1. Teknik kılavuza ve yaş doğrulama hizmetine erişmek için bir başvuru, kayıt ya da bildirim
   gerekiyor mu? Bireysel geliştiriciler (şirket olmayan sağlayıcılar) bu hizmete erişebilecek mi?
2. Sağlayıcı, belirtecin Başkanlıkça üretildiğini hangi yolla doğrulayacak (ör. imza ve açık
   anahtar ya da bir doğrulama servisi)? Belirtecin biçimi ve geçerlilik süresi nedir?
3. Mobil uygulamalarda belirteç uygulamaya nasıl aktarılacak (ör. e-Devlet'ten uygulamaya geri
   dönüş bağlantısı, kopyalama ya da QR kod)?
4. Entegrasyonu denemek için bir test ortamı sağlanacak mı?
5. Kılavuzun yayımlanması için öngörülen bir tarih var mı? Mevcut hesapların 31 Mart 2027'ye kadar
   doğrulanması için sağlayıcılara ne kadar süre tanınması planlanıyor?
6. Belirteç entegrasyonu mümkün olana kadar, herkese açık yayından önceki kapalı test aşamasında
   kullanıcıdan yaş grubu beyanı alınması uygun bir geçici önlem midir?

Bargu'da kullanıcıların doğum tarihi ya da kimlik bilgisi tutulmamaktadır; yalnızca yaş grubu (15–17
ya da 18 ve üstü) saklanmaktadır. Belirteç entegre edildiğinde de belirtecin kendisini saklamayıp
yalnızca doğrulama sonucunu tutmayı planlıyorum.

Bilgilerinize sunar, gereğini saygılarımla arz ederim.

[Ad Soyad]
Bargu uygulaması geliştiricisi
[İl / adres]
[E-posta]
[Telefon (isteğe bağlı)]
[Tarih]
