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

Son güncelleme: 29.10.2026

**Kısaca:** Bargu, konumunu yalnızca seçtiğin kişilerle paylaşmak için var. Konumun ve mesajların telefonunda şifrelenir; bizim sunucumuz bile okuyamaz. Mesajlar ve fotoğraflar 24 saatte silinir. Reklam yok, verini satmayız, rehberine ya da telefon numarana bakmayız.

## 1. Veri sorumlusu

Serkan Fidancı (Otenus markasıyla), bireysel geliştirici, Türkiye. İletişim ve KVKK başvuruları: support@otenus.com. (6698 sayılı KVKK kapsamında veri sorumlusu.)

## 2. Hangi verileri işliyoruz?

| Veri                                                                                | Neden                                                                        | Nasıl korunur                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E-posta adresi                                                                      | Giriş ve hesap güvenliği (kod göndermek)                                     | Veritabanında düz adres tutulmaz, anahtarlı özet tutulur                                                                                                                                                                                                                                                                                                                                                                                                            |
| Kullanıcı adı, görünen ad, renk, emoji                                              | Arkadaşların seni bulması ve tanıması                                        | Sunucuda şifresiz saklanır; yalnızca ilgili kişilere gösterilir                                                                                                                                                                                                                                                                                                                                                                                                     |
| Konumun                                                                             | Seçtiğin çemberlerle canlı konum paylaşımı                                   | Telefonunda uçtan uca şifrelenir; sunucu okuyamaz; şifreli hâli en çok 24 saat durur. Kime, ne kadar süre göstereceğin (kişiye özel paylaşım) yalnızca telefonunda şifreli durur                                                                                                                                                                                                                                                                                    |
| Çember geçmişi (**isteğe bağlı, kapalı başlar**)                                    | Sen açarsan son 14 günün iz kaydı                                            | Şifreli; 14 gün sonra silinir; kapatınca silinir                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Kendi konum geçmişin (**isteğe bağlı, kapalı başlar, Bargu+**)                      | Sen açarsan gün gün izin, durakların ve gezdiğin yerler, yalnızca sana       | Yalnızca telefonunda şifreli durur; sunucumuza hiç gitmez, biz göremeyiz. Anahtarı telefonun kilidi açıkken okunur. 30 gün ya da 1 yıl (sen seçersin). Kapatınca, çıkış yapınca ya da hesabını silince telefondan silinir. Telefon değişince taşınmaz                                                                                                                                                                                                               |
| Profil fotoğrafı (isteğe bağlı)                                                     | Arkadaşlarında görünmesi                                                     | Şifreli yüklenir; yalnızca güvendiğin arkadaşlar açar                                                                                                                                                                                                                                                                                                                                                                                                               |
| Mesajlar, anlık fotoğraflar ve hikayeler (isteğe bağlı)                             | Çember üyeleriyle yazışmak ve o an çekilen fotoğrafı paylaşmak               | Uçtan uca şifreli; sunucu okuyamaz; 24 saat sonra sunucudan ve telefonlardan silinir. Fotoğraf yalnızca uygulamanın kamerasıyla çekilir; içindeki konum bilgisi (EXIF) silinir. Bir hikayeyi açtığında adın ve açtığın saat, uçtan uca şifreli olarak yalnızca hikayeyi paylaşana gider; liste 24 saatte silinir. Mesajlar için okundu bilgisi yoktur. "Yakındayım" daveti de bir mesajdır; içinde yer ya da mesafe yoktur, mesafeyi alan kişinin telefonu hesaplar |
| Bildirdiğin içerik                                                                  | Kötüye kullanımı önlemek ve güvenlik                                         | "Bildir"e bastığında yalnızca o mesaj ya da fotoğraf açık hâliyle bize gelir; şifreli saklanır, 90 gün sonra silinir                                                                                                                                                                                                                                                                                                                                                |
| Engelleme listen                                                                    | Engellediğin kişinin sana yazamaması                                         | Engeli kaldırana ya da hesabını silene kadar                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Destek yazışmaların (isteğe bağlı)                                                  | "Sorun bildir" ile ya da e-postayla bize yazdığında sorunu çözmek            | Kendi e-posta uygulamandan gider; yazdığın metin, uygulama sürümü, telefon modeli ve eklersen ekran görüntüsü. Konum ve mesaj eklenmez. Sorun çözüldükten sonra en geç 12 ay saklanır                                                                                                                                                                                                                                                                               |
| Yerlerin (ev, okul vb.) ve etkinlik bilgileri                                       | Varış bildirimleri, planlama                                                 | Şifreli; etkinlik bitince silinir                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Cihaz anahtarları, bildirim kodu (FCM token), cihaz doğrulaması (Play Integrity)    | Hesabın cihazına bağlanması, bildirim gönderme, sahte uygulamaları engelleme | Anahtarlar telefondan çıkmaz; yalnızca açık anahtarlar sunucuya gider                                                                                                                                                                                                                                                                                                                                                                                               |
| Kullanım olayları (kim hangi çemberde, kim kime ne zaman yazdı, bildirim zamanları) | Uygulamanın çalışması ve güvenliği                                           | İçerik görülmez, yalnızca tür ve zaman; mesaj kayıtları 24 saatte silinir                                                                                                                                                                                                                                                                                                                                                                                           |

Kullanmadığımız şeyler: rehber, telefon numarası, mikrofon, fotoğraf galerin, reklam kimliği, analitik/izleme kitaplığı, kesin adres bilgisi. IP adresi hız sınırı için anlık işlenir, kayda geçmez.

## 3. İşleme amacı ve hukuki sebep

- Hesabı açmak ve konum paylaşımını sağlamak: **sözleşmenin ifası** (KVKK m.5/2-c).
- Konum paylaşımı da uygulamanın ana hizmetidir; **sözleşmenin ifası** kapsamındadır. İsteğe bağlı işlemler (çember geçmişi, profil fotoğrafı) için ayrı bir **açık rıza** ekranı gösterilir; bu aydınlatma metninden ayrıdır ve istediğin an geri çekebilirsin (geçmişi kapat, fotoğrafı sil). İstediğin an çemberi kapatabilir ya da hayalet modunu açabilirsin.
- Mesajlaşma ve fotoğraf paylaşımı da hizmetin parçasıdır: **sözleşmenin ifası**.
- Güvenlik, kötüye kullanımı önleme (bildirilen içeriğin incelenmesi dahil), yasal yükümlülükler: **meşru menfaat** ve **hukuki yükümlülük** (m.5/2-f, 5/2-ç).

## 4. Kimlerle paylaşırız?

Verilerini **satmayız, reklam için paylaşmayız**. Yalnızca hizmeti çalıştırmak için kullandığımız hizmet sağlayıcılar vardır:

- **Barındırma:** Hetzner (Avrupa Birliği içinde sunucu).
- **Bildirim:** Google Firebase Cloud Messaging (bildirim kodun ve şifreli bildirim; içeriği okuyamaz).
- **E-posta gönderimi:** Google Workspace (Google LLC; sunucular ABD ve AB).
- **Hava durumu:** yalnızca sabit bir ızgara sorgulanır; senin konumun gitmez.
  Google (ABD) gibi yurt dışındaki sağlayıcılara aktarım KVKK m.9 şartlarına uygun yapılır; bildirimin içeriği şifreli olduğu için sağlayıcı konumunu okuyamaz.

**Yetkililer:** Bildirilen bir içerik çocuk istismarı içeriyorsa, o içeriği ve ilgili hesap bilgilerini yasanın gerektirdiği yetkililere iletiriz. Bunun dışında yalnızca yasal bir zorunluluk olduğunda ve elimizde olan kadarını veririz; şifreli içeriği zaten okuyamayız.

## 5. Ne kadar saklarız?

Canlı konum zarfı en çok 24 saat. Mesajlar, fotoğraflar ve hikayeler en çok 24 saat; gönderen silerse hemen silinir ve yedeklere girmez. Bildirilen içerik 90 gün; çocuk istismarında yasanın gerektirdiği süre. Kendi konum geçmişin (açtıysan) yalnızca telefonunda, seçtiğin kadar: 30 gün ya da 1 yıl. Çember geçmişi (açtıysan) en çok 14 gün. Etkinlik çemberleri bitince silinir. Hesap bilgilerin hesabını silene kadar. Silince hesabın hemen kapanır ve en geç 7 gün içinde sunucudan tamamen kaldırılır; yedeklerden 30 gün içinde düşer. Güvenlik amacıyla tutulan kayıtlar (giriş, yeni telefon, oturum olayları; IP ve konum yok) en çok 90 gün ve 100 olay saklanır.

## 6. Hesabını ve verini silme

Uygulamada: **Ben → Hesap ve veri → Hesabımı sil**. Uygulamaya erişemiyorsan: [https://bargu.app/hesap] sayfasında e-posta koduyla giriş yapıp hesabını silebilirsin. Silinince çemberlerinden çıkarılır, anahtarların ve fotoğrafın silinir. Çembere eklediğin yerler (ev, okul gibi) çembere aittir ve şifrelidir; sunucu onları kimin eklediğini bilmediği için çemberde kalır. İstersen silmeden önce kendin silebilirsin (ADR 0022).

## 7. Haklarınız (KVKK m.11)

Verinin işlenip işlenmediğini öğrenme, bilgi isteme, düzeltme, silme/yok etme, aktarılan kişileri öğrenme, itiraz ve zarar giderim isteme haklarına sahipsin. support@otenus.com adresine yaz; en geç 30 gün içinde yanıtlarız. Şikâyet için Kişisel Verileri Koruma Kurumu'na (kvkk.gov.tr) başvurabilirsin.

## 8. Çocuklar

Bargu **15 yaşından küçükler tarafından kullanılamaz.** 15–17 yaş arasındaki kullanıcılar için ayrı kurallar geçerlidir: daha gizli varsayılan ayarlar, kullanıcı adıyla bulunamama, isteğe bağlı ebeveyn bağlantısı (bağlantı konumu taşımaz; ebeveyn yalnızca kişilerin görünen adlarını, günlük kullanım süresini ve onay isteklerini görür) ve ücretli işlemlerde ebeveyn onayı. 15–17 yaş kullanıcılar da yalnızca çember üyeleriyle yazışabilir; ebeveyn mesajları ve fotoğrafları göremez. Her mesajda ve fotoğrafta Bildir ve Engelle vardır. 15 yaşından küçük birinin hesap açtığını fark edersek hesabı kapatırız.

## 9. Güvenlik

Konum, mesajlar, fotoğraflar ve geçmiş uçtan uca şifrelenir; bağlantılar TLS ile korunur. Mesajlaşma kuralları ve çocuk güvenliği standartlarımız: [https://www.otenus.com/bargu/kurallar], [https://www.otenus.com/bargu/cocuk-guvenligi]. Hiçbir sistem yüzde yüz güvenli değildir. Telefonunu kaybedersen yeni cihazdan girerek eskisini iptal edebilirsin. Güvenlik açığı bildirmek için: support@otenus.com.

## 10. Değişiklikler

Politika değişirse uygulamada ve bu sayfada duyururuz; önemli değişikliklerde yeniden onay isteriz.

---

## English

---

# Bargu Privacy Policy

Last updated: 29.10.2026

**In short:** Bargu exists to share your location only with people you choose. Your location and messages are encrypted on your phone and our server cannot read them. Messages and photos are deleted after 24 hours. No ads, we do not sell your data, and we never look at your contacts or phone number.

## 1. Who is responsible

Serkan Fidancı (publishing as Otenus), an individual developer in Türkiye. Contact and data requests: support@otenus.com. This person is the data controller (Turkish Personal Data Protection Law No. 6698, "KVKK"; this page is also the information notice the law requires).

## 2. What we process

| Data                                                                        | Why                                                                                            | Protection                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Email address                                                               | Sign-in and account security (sending your code)                                               | No plain address in the database; a keyed hash is stored                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Username, display name, colour, emoji                                       | So friends can find and recognise you                                                          | Stored unencrypted; shown only to relevant people                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Your location                                                               | Live location sharing with the circles you pick                                                | End-to-end encrypted on your phone; the server cannot read it; the encrypted form stays at most 24 hours. Who sees you and for how long (per-person sharing) stays only on your phone, encrypted                                                                                                                                                                                                                                                                                           |
| Circle history (**optional, off by default**)                               | The last 14 days of your trail, only if you turn it on                                         | Encrypted; deleted after 14 days; deleted when you turn it off                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Your own location history (**optional, off by default, Bargu+**)            | If you turn it on: your trail day by day, your stops and the places you visited, for you alone | Stays only on your phone, encrypted; never sent to our server, we cannot see it. Its key opens only while your phone is unlocked. 30 days or 1 year (your choice). Deleted from your phone when you turn it off, sign out or delete your account. It does not move to a new phone                                                                                                                                                                                                          |
| Profile photo (optional)                                                    | Show you to friends                                                                            | Uploaded encrypted; only trusted friends can open it                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Messages, instant photos and stories (optional)                             | Chatting and sharing a photo taken right now with your circle members                          | End-to-end encrypted; the server cannot read them; deleted from the server and phones after 24 hours. Photos are taken only with the app's camera; their location data (EXIF) is removed. When you open a story, your name and the time go, end-to-end encrypted, only to the person who shared it; the list is deleted after 24 hours. Messages have no read receipts. An "I'm nearby" invite is a message too; it holds no place or distance, the receiving phone works out the distance |
| Content you report                                                          | Preventing abuse and keeping people safe                                                       | When you tap "Report", only that message or photo reaches us in readable form; stored encrypted, deleted after 90 days                                                                                                                                                                                                                                                                                                                                                                     |
| Your block list                                                             | So people you block cannot write to you                                                        | Until you unblock or delete your account                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Your support messages (optional)                                            | Solving the problem when you write to us with "Report a problem" or by email                   | Sent from your own email app: your text, the app version, the phone model and, if you add one, a screenshot. No location or messages are added. Kept for at most 12 months after the problem is solved                                                                                                                                                                                                                                                                                     |
| Places (home, school…) and event data                                       | Arrival notices and planning                                                                   | Encrypted; events are deleted when they end                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Device keys, notification token (FCM), device check (Play Integrity)        | Bind your account to your device, send notifications, block fake apps                          | Private keys never leave your phone; only public keys reach the server                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Usage events (which circle, who wrote to whom and when, notification times) | Making the app work and keeping it safe                                                        | No content, only type and time; message records are deleted after 24 hours                                                                                                                                                                                                                                                                                                                                                                                                                 |

What we do not use: contacts, phone number, microphone, your photo gallery, advertising ID, analytics or tracking libraries, street addresses. Your IP address is used briefly for rate limiting and is not logged.

## 3. Purposes and legal basis

Creating your account and sharing location: performance of the contract. Location sharing is the core service (performance of the contract). Optional features (circle history, profile photo) rest on a separate explicit-consent screen, distinct from this notice, which you can withdraw at any time (turn history off, delete the photo). You can also turn a circle off or use ghost mode at any time. Messaging and photo sharing are part of the service too (performance of the contract). Security, abuse prevention (including reviewing reported content) and legal duties: legitimate interest and legal obligation.

## 4. Who receives it

We **do not sell** your data and do not share it for ads. Only service providers that run the service: hosting (Hetzner, EU), notifications (Google Firebase Cloud Messaging; content is encrypted, so it cannot read your location), email delivery (Google Workspace, Google LLC; servers in the US and EU), and weather (a fixed grid only; your location is not sent). Transfers to providers outside Turkey follow KVKK Article 9.

**Authorities:** if reported content involves child sexual abuse, we pass that content and the related account details to the authorities the law requires. Otherwise we disclose data only when legally required, and only what we hold; we cannot read encrypted content.

## 5. Retention

Encrypted live-location envelope: at most 24 hours. Messages, photos and stories: at most 24 hours; deleted at once if the sender deletes them, and never kept in backups. Reported content: 90 days, or as long as the law requires for child sexual abuse. Your own location history (if you turned it on): only on your phone, as long as you chose, 30 days or 1 year. Circle history (if on): at most 14 days. Event circles: deleted when they end. Account data: until you delete your account. On deletion your account closes at once and is fully removed from the server within 7 days; backups roll off within 30 days. Security records (sign-ins, new phones, session events; no IP address and no location) are kept for at most 90 days and 100 events.

## 6. Deleting your account and data

In the app: **Me → Account and data → Delete my account**. If you cannot open the app: sign in with an email code at [https://bargu.app/hesap] and delete your account there. Deletion removes you from circles and deletes your keys and photo. Places you added to a circle (such as home or school) belong to the circle and are encrypted; the server does not know who added them, so they stay in the circle. You can delete them yourself before deleting your account.

## 7. Your rights (KVKK Article 11 and, for EU users, GDPR)

Ask whether your data is processed, request a copy, correct, erase, object, and claim damages. Write to support@otenus.com; we reply within 30 days. You can complain to the Turkish Personal Data Protection Authority (kvkk.gov.tr) or, if you are in the EU, to your local data protection authority.

## 8. Children

Bargu **cannot be used by anyone under 15.** Users aged 15 to 17 get separate rules: more private defaults, no finding by username, an optional parent link (the link carries no location; the parent only sees display names, daily usage time and approval requests) and parent approval for paid purchases. Users aged 15 to 17 can also write only to their circle members; parents cannot see messages or photos. Every message and photo has Report and Block. If we learn that someone under 15 has an account, we close it.

## 9. Security

Location, messages, photos and history are end-to-end encrypted; connections use TLS. Our messaging rules and child safety standards: [https://www.otenus.com/bargu/kurallar], [https://www.otenus.com/bargu/cocuk-guvenligi]. No system is perfectly secure. If you lose your phone, signing in on a new device revokes the old one. Report security issues to support@otenus.com.

## 10. Changes

We announce changes in the app and on this page, and ask again for important ones.

---

## Doldurulacak alanlar (kısa liste)

Ad-adres, destek e-postası, güvenlik e-postası, tarih, e-posta servisi adı, silme sayfası URL'si, yaş sınırı (15+ olarak yazıldı; Faz 9 kuralları gelince güncelle), yedek/silme süreleri, Bargu+ gelince satın alma ve Google Play ödeme paragrafı, kalıcı alan adı.
