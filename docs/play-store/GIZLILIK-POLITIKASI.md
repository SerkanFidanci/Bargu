# Gizlilik Politikası Taslağı (TR + EN)

**Taslaktır; yayından önce avukat ya da en azından sahip okuyup `[…]` alanlarını doldurmalı.** Metin KVKK m.10 aydınlatma yükümlülüğünü (veri sorumlusu, amaç, hukuki sebep, aktarım, haklar, başvuru) kapsayacak biçimde yazıldı; ayrı bir aydınlatma metni gerekmiyor, aynı sayfa ikisini birden karşılar. Veriler VERI-GUVENLIGI.md ve THREAT_MODEL.md ile aynıdır; biri değişirse üçü birlikte güncellenir.

## Nerede yayınlanır (öneri)

| Seçenek                                                                             | Artı                                                                                             | Eksi                                                                                             |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| **GitHub Pages** (ayrı, herkese açık küçük depo; ör. `bargu-legal`) — **ilk öneri** | Ücretsiz, sunucudan bağımsız, her zaman açık, Play'in "etkin, herkese açık URL, PDF değil" şartı | Adres `…github.io/…` görünür; kalıcı alan adı gelince özel alan adı bağlanır                     |
| Staging sunucusunda Nginx `/gizlilik`                                               | Tek yerde                                                                                        | sslip.io geçici; ortak sunucu (rastamen ile paylaşılıyor); alan adı değişince Play kaydı bozulur |
| Kalıcı alan adı (ör. `bargu.app`)                                                   | En profesyonel                                                                                   | Henüz alınmadı; alınınca GitHub Pages'e özel alan adı olarak bağla                               |

Play şartı: URL herkese açık, geçerli, PDF değil; uygulama adı ve geliştirici adı geçmeli. Silme sayfası aynı yerde (`/sil`) olmalı (Play hesap silme web bağlantısı). Uygulamada da "Ben" ekranında bağlantı olmalı (kod K7).

## Türkçe

---

# Bargu Gizlilik Politikası ve KVKK Aydınlatma Metni

Son güncelleme: [GG.AA.YYYY]

**Kısaca:** Bargu, konumunu yalnızca seçtiğin kişilerle paylaşmak için var. Konumun telefonunda şifrelenir; bizim sunucumuz bile okuyamaz. Reklam yok, verini satmayız, rehberine ya da telefon numarana bakmayız.

## 1. Veri sorumlusu

[Ad Soyad], bireysel geliştirici. Adres: [adres]. İletişim: [destek e-postası]. (6698 sayılı KVKK kapsamında veri sorumlusu.)

## 2. Hangi verileri işliyoruz?

| Veri                                                                             | Neden                                                                        | Nasıl korunur                                                                        |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| E-posta adresi                                                                   | Giriş ve hesap güvenliği (kod göndermek)                                     | Veritabanında düz adres tutulmaz, anahtarlı özet tutulur                             |
| Kullanıcı adı, görünen ad, renk, emoji                                           | Arkadaşların seni bulması ve tanıması                                        | Sunucuda şifresiz saklanır; yalnızca ilgili kişilere gösterilir                      |
| Konumun                                                                          | Seçtiğin çemberlerle canlı konum paylaşımı                                   | Telefonunda uçtan uca şifrelenir; sunucu okuyamaz; şifreli hâli en çok 24 saat durur |
| Çember geçmişi (**isteğe bağlı, kapalı başlar**)                                 | Sen açarsan son 14 günün iz kaydı                                            | Şifreli; 14 gün sonra silinir; kapatınca silinir                                     |
| Profil fotoğrafı (isteğe bağlı)                                                  | Arkadaşlarında görünmesi                                                     | Şifreli yüklenir; yalnızca güvendiğin arkadaşlar açar                                |
| Yerlerin (ev, okul vb.) ve etkinlik bilgileri                                    | Varış bildirimleri, planlama                                                 | Şifreli; etkinlik bitince silinir                                                    |
| Cihaz anahtarları, bildirim kodu (FCM token), cihaz doğrulaması (Play Integrity) | Hesabın cihazına bağlanması, bildirim gönderme, sahte uygulamaları engelleme | Anahtarlar telefondan çıkmaz; yalnızca açık anahtarlar sunucuya gider                |
| Kullanım olayları (kim hangi çemberde, bildirim zamanları)                       | Uygulamanın çalışması ve güvenliği                                           | İçerik görülmez, yalnızca tür ve zaman                                               |

Kullanmadığımız şeyler: rehber, telefon numarası, mikrofon, reklam kimliği, analitik/izleme kitaplığı, kesin adres bilgisi. IP adresi hız sınırı için anlık işlenir, kayda geçmez.

## 3. İşleme amacı ve hukuki sebep

- Hesabı açmak ve konum paylaşımını sağlamak: **sözleşmenin ifası** (KVKK m.5/2-c).
- Konum paylaşımı da uygulamanın ana hizmetidir; **sözleşmenin ifası** kapsamındadır. İsteğe bağlı işlemler (çember geçmişi, profil fotoğrafı) için ayrı bir **açık rıza** ekranı gösterilir; bu aydınlatma metninden ayrıdır ve istediğin an geri çekebilirsin (geçmişi kapat, fotoğrafı sil). İstediğin an çemberi kapatabilir ya da hayalet modunu açabilirsin.
- Güvenlik, kötüye kullanımı önleme, yasal yükümlülükler: **meşru menfaat** ve **hukuki yükümlülük** (m.5/2-f, 5/2-ç).

## 4. Kimlerle paylaşırız?

Verilerini **satmayız, reklam için paylaşmayız**. Yalnızca hizmeti çalıştırmak için kullandığımız hizmet sağlayıcılar vardır:

- **Barındırma:** Hetzner (Avrupa Birliği içinde sunucu).
- **Bildirim:** Google Firebase Cloud Messaging (bildirim kodun ve şifreli bildirim; içeriği okuyamaz).
- **E-posta gönderimi:** [e-posta servisi adı, ülke].
- **Hava durumu:** yalnızca sabit bir ızgara sorgulanır; senin konumun gitmez.
  Google (ABD) gibi yurt dışındaki sağlayıcılara aktarım KVKK m.9 şartlarına uygun yapılır; bildirimin içeriği şifreli olduğu için sağlayıcı konumunu okuyamaz.

## 5. Ne kadar saklarız?

Canlı konum zarfı en çok 24 saat. Geçmiş (açtıysan) en çok 14 gün. Etkinlik çemberleri bitince silinir. Hesap bilgilerin hesabını silene kadar. Silince [en çok 30 gün içinde] sunucudan kaldırılır; yedekler [30] gün içinde döner. Güvenlik amacıyla tutulan bir kayıt kalırsa burada süresiyle yazılır: [yok / …].

## 6. Hesabını ve verini silme

Uygulamada: **Ben → Ayarlar → Hesabı sil**. Uygulamaya erişemiyorsan: [https://…/sil] sayfasından e-posta kodu ile silme talebi gönder. Silinince çemberlerinden çıkarılır, anahtarların ve fotoğrafın silinir.

## 7. Haklarınız (KVKK m.11)

Verinin işlenip işlenmediğini öğrenme, bilgi isteme, düzeltme, silme/yok etme, aktarılan kişileri öğrenme, itiraz ve zarar giderim isteme haklarına sahipsin. [destek e-postası] adresine yaz; en geç 30 gün içinde yanıtlarız. Şikâyet için Kişisel Verileri Koruma Kurumu'na (kvkk.gov.tr) başvurabilirsin.

## 8. Çocuklar

Bargu **15 yaşından küçükler tarafından kullanılamaz.** 15–18 yaş arasındaki kullanıcılar için ayrı kurallar (kapalı varsayılan ayarlar, ebeveyn araçları, yaş doğrulama, ücretli işlemlerin sınırlanması) uygulamaya eklenecek ve bu sayfada duyurulacaktır. 15 yaşından küçük birinin hesap açtığını fark edersek hesabı kapatırız.

## 9. Güvenlik

Konum, fotoğraf ve geçmiş uçtan uca şifrelenir; bağlantılar TLS ile korunur. Hiçbir sistem yüzde yüz güvenli değildir. Telefonunu kaybedersen yeni cihazdan girerek eskisini iptal edebilirsin. Güvenlik açığı bildirmek için: [güvenlik e-postası].

## 10. Değişiklikler

Politika değişirse uygulamada ve bu sayfada duyururuz; önemli değişikliklerde yeniden onay isteriz.

---

## English

---

# Bargu Privacy Policy

Last updated: [DD.MM.YYYY]

**In short:** Bargu exists to share your location only with people you choose. Your location is encrypted on your phone and our server cannot read it. No ads, we do not sell your data, and we never look at your contacts or phone number.

## 1. Who is responsible

[Full name], an individual developer. Address: [address]. Contact: [support email]. This person is the data controller (Turkish Personal Data Protection Law No. 6698, "KVKK"; this page is also the information notice the law requires).

## 2. What we process

| Data                                                                 | Why                                                                   | Protection                                                                                               |
| -------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Email address                                                        | Sign-in and account security (sending your code)                      | No plain address in the database; a keyed hash is stored                                                 |
| Username, display name, colour, emoji                                | So friends can find and recognise you                                 | Stored unencrypted; shown only to relevant people                                                        |
| Your location                                                        | Live location sharing with the circles you pick                       | End-to-end encrypted on your phone; the server cannot read it; the encrypted form stays at most 24 hours |
| Circle history (**optional, off by default**)                        | The last 14 days of your trail, only if you turn it on                | Encrypted; deleted after 14 days; deleted when you turn it off                                           |
| Profile photo (optional)                                             | Show you to friends                                                   | Uploaded encrypted; only trusted friends can open it                                                     |
| Places (home, school…) and event data                                | Arrival notices and planning                                          | Encrypted; events are deleted when they end                                                              |
| Device keys, notification token (FCM), device check (Play Integrity) | Bind your account to your device, send notifications, block fake apps | Private keys never leave your phone; only public keys reach the server                                   |
| Usage events (which circle, notification times)                      | Making the app work and keeping it safe                               | No content, only type and time                                                                           |

What we do not use: contacts, phone number, microphone, advertising ID, analytics or tracking libraries, street addresses. Your IP address is used briefly for rate limiting and is not logged.

## 3. Purposes and legal basis

Creating your account and sharing location: performance of the contract. Location sharing is the core service (performance of the contract). Optional features (circle history, profile photo) rest on a separate explicit-consent screen, distinct from this notice, which you can withdraw at any time (turn history off, delete the photo). You can also turn a circle off or use ghost mode at any time. Security, abuse prevention and legal duties: legitimate interest and legal obligation.

## 4. Who receives it

We **do not sell** your data and do not share it for ads. Only service providers that run the service: hosting (Hetzner, EU), notifications (Google Firebase Cloud Messaging; content is encrypted, so it cannot read your location), email delivery ([provider, country]), and weather (a fixed grid only; your location is not sent). Transfers to providers outside Turkey follow KVKK Article 9.

## 5. Retention

Encrypted live-location envelope: at most 24 hours. History (if on): at most 14 days. Event circles: deleted when they end. Account data: until you delete your account; after deletion removed within [30] days, backups roll off within [30] days. Records kept for security reasons: [none / …].

## 6. Deleting your account and data

In the app: **Me → Settings → Delete account**. If you cannot open the app: use [https://…/delete] with an email code. Deletion removes you from circles and deletes your keys and photo.

## 7. Your rights (KVKK Article 11 and, for EU users, GDPR)

Ask whether your data is processed, request a copy, correct, erase, object, and claim damages. Write to [support email]; we reply within 30 days. You can complain to the Turkish Personal Data Protection Authority (kvkk.gov.tr) or, if you are in the EU, to your local data protection authority.

## 8. Children

Bargu **cannot be used by anyone under 15.** Separate rules for users aged 15 to 18 (closed-by-default settings, parental tools, age verification, limits on paid purchases) will be added to the app and announced on this page. If we learn that someone under 15 has an account, we close it.

## 9. Security

Location, photos and history are end-to-end encrypted; connections use TLS. No system is perfectly secure. If you lose your phone, signing in on a new device revokes the old one. Report security issues to [security email].

## 10. Changes

We announce changes in the app and on this page, and ask again for important ones.

---

## Doldurulacak alanlar (kısa liste)

Ad-adres, destek e-postası, güvenlik e-postası, tarih, e-posta servisi adı, silme sayfası URL'si, yaş sınırı (15+ olarak yazıldı; Faz 9 kuralları gelince güncelle), yedek/silme süreleri, Bargu+ gelince satın alma ve Google Play ödeme paragrafı, kalıcı alan adı.
