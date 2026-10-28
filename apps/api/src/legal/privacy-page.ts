/**
 * The privacy policy and KVKK information notice (docs/ADR/0022, docs/play-store/
 * GIZLILIK-POLITIKASI.md), served at /gizlilik in Turkish and English. Plain HTML with the account
 * page's stylesheet; nothing from elsewhere. Follows the PM's text of 27.10.2026 (messages and
 * stories, ADR 0035) and of 29.10.2026 (who opened a story, Ek 1; the notice version stays); it also keeps what this page said before of the age band, findability,
 * parent links and the notice records, which that text does not list yet.
 */

export const PRIVACY_PAGE_CSP = [
  "default-src 'none'",
  "style-src 'self'",
  "img-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** When the text last changed; the in-app notice version follows it (PRIVACY_NOTICE_VERSION). */
const UPDATED = '29.10.2026';

export const PRIVACY_PAGE_HTML = `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Bargu Gizlilik Politikası / Privacy Policy</title>
<link rel="stylesheet" href="/hesap/app.css">
</head>
<body>
<main>
<p><a href="#en">English below</a></p>
<article lang="tr">
<h1>Bargu Gizlilik Politikası ve KVKK Aydınlatma Metni</h1>
<p>Son güncelleme: ${UPDATED}</p>
<p><strong>Kısaca:</strong> Bargu, konumunu yalnızca seçtiğin kişilerle paylaşmak için var. Konumun ve mesajların telefonunda şifrelenir; bizim sunucumuz bile okuyamaz. Mesajlar ve fotoğraflar 24 saatte silinir. Reklam yok, verini satmayız, rehberine ya da telefon numarana bakmayız.</p>

<h2>1. Veri sorumlusu</h2>
<p>Serkan Fidancı (Otenus markasıyla), bireysel geliştirici, Türkiye. İletişim ve KVKK başvuruları: support@otenus.com. 6698 sayılı Kişisel Verilerin Korunması Kanunu (KVKK) kapsamında veri sorumlusudur.</p>

<h2>2. Hangi verileri işliyoruz?</h2>
<ul>
<li><strong>E-posta adresi:</strong> giriş ve hesap güvenliği için kod göndermek. Veritabanında düz adres tutulmaz, anahtarlı özeti tutulur.</li>
<li><strong>Kullanıcı adı, görünen ad, renk, emoji:</strong> arkadaşlarının seni bulması ve tanıması için. Sunucuda şifresiz saklanır; yalnızca ilgili kişilere gösterilir.</li>
<li><strong>Konumun:</strong> seçtiğin çemberlerle canlı konum paylaşımı için. Telefonunda uçtan uca şifrelenir, sunucu okuyamaz; şifreli hâli en çok 24 saat durur.</li>
<li><strong>Çember geçmişi (isteğe bağlı, kapalı başlar, açık rızaya dayanır):</strong> açtığın çemberde son 14 günün izi. Şifreli; 14 gün sonra ya da kapatınca silinir.</li>
<li><strong>Profil fotoğrafı (isteğe bağlı):</strong> arkadaşlarında görünmesi için. Şifreli yüklenir; yalnızca güvendiğin arkadaşların açar.</li>
<li><strong>Mesajlar, anlık fotoğraflar ve hikayeler (isteğe bağlı):</strong> çember üyeleriyle yazışmak ve o an çekilen fotoğrafı paylaşmak için. Uçtan uca şifreli, sunucu okuyamaz; 24 saat sonra sunucudan ve telefonlardan silinir. Fotoğraf yalnızca uygulamanın kamerasıyla çekilir; içindeki konum bilgisi (EXIF) silinir. Bir hikayeyi açtığında adın ve açtığın saat, uçtan uca şifreli olarak yalnızca hikayeyi paylaşana gider; liste 24 saatte silinir. Mesajlar için okundu bilgisi yoktur.</li>
<li><strong>Bildirdiğin içerik:</strong> kötüye kullanımı önlemek ve güvenlik için. "Bildir"e bastığında yalnızca o mesaj ya da fotoğraf açık hâliyle bize gelir; şifreli saklanır, 90 gün sonra silinir.</li>
<li><strong>Engelleme listen:</strong> engellediğin kişinin sana yazamaması için. Engeli kaldırana ya da hesabını silene kadar tutulur.</li>
<li><strong>Yerlerin (ev, okul vb.) ve etkinlik bilgileri:</strong> varış bildirimleri ve planlama için. Şifreli; etkinlik bitince silinir.</li>
<li><strong>Cihaz anahtarları, bildirim kodu (FCM token), cihaz doğrulaması (Play Integrity):</strong> hesabın cihazına bağlanması, bildirim gönderme, sahte uygulamaları engelleme. Gizli anahtarlar telefondan çıkmaz; yalnızca açık anahtarlar sunucuya gider.</li>
<li><strong>Kullanım olayları (kim hangi çemberde, kim kime ne zaman yazdı, bildirim zamanları):</strong> uygulamanın çalışması ve güvenliği için. İçerik görülmez, yalnızca tür ve zaman; mesaj kayıtları 24 saatte silinir.</li>
<li><strong>Aydınlatma, rıza ve kural kayıtları:</strong> bu metni okuduğun, çember geçmişine rıza verdiğin ya da geri çektiğin ve topluluk kurallarını kabul ettiğin zaman.</li>
<li><strong>Yaş grubun:</strong> "15–17" ya da "18 veya üstü" ve bunu ne zaman söylediğin. Doğum tarihin ya da yaşın sorulmaz, tutulmaz. Yaş grubun başka kullanıcılara gösterilmez.</li>
<li><strong>Bulunabilirlik ayarın:</strong> başkalarının seni kullanıcı adınla bulup bulamayacağı. 18 yaş ve üstünde açık başlar, kapatabilirsin; 15–17 yaşında hep kapalıdır.</li>
<li><strong>Ebeveyn bağlantıları (isteğe bağlı, 15–17):</strong> kimin kimin ebeveyni olduğu, bağlantının ne zaman kurulduğu ve bitirme isteği; ebeveynin ayarları (yeni kişiler için onay, günlük süre sınırı), onay bekleyen istekler (en çok 7 gün) ve uygulamanın günde kaç dakika açık kaldığı (son 7 gün). Son bağlantı bitince hepsi silinir.</li>
</ul>
<p>Kullanmadığımız şeyler: rehber, telefon numarası, mikrofon, fotoğraf galerin, reklam kimliği, analitik ya da izleme kitaplığı, kesin adres bilgisi. IP adresi hız sınırı için anlık işlenir, kayda geçmez.</p>

<h2>3. İşleme amacı ve hukuki sebep</h2>
<ul>
<li>Hesabı açmak ve konum paylaşımını sağlamak: <strong>sözleşmenin ifası</strong> (KVKK m.5/2-c). Konum paylaşımı uygulamanın ana hizmetidir. İstediğin an çemberi kapatabilir ya da hayalet modunu açabilirsin.</li>
<li>Çember geçmişi: <strong>açık rıza</strong> (KVKK m.5/1). Geçmişi ilk açarken bu aydınlatma metninden ayrı bir rıza ekranı gösterilir; rızanı istediğin an geri çekebilirsin (Ben → Hesap ve veri → Rızamı geri çek). Geri çekince geçmiş her çemberde kapanır ve sunucudaki kopyası silinir. Profil fotoğrafı da isteğe bağlıdır; istediğin an silebilirsin.</li>
<li>Mesajlaşma ve fotoğraf paylaşımı da hizmetin parçasıdır: <strong>sözleşmenin ifası</strong>.</li>
<li>Güvenlik, kötüye kullanımı önleme (bildirilen içeriğin incelenmesi dahil) ve yasal yükümlülükler: <strong>meşru menfaat</strong> ve <strong>hukuki yükümlülük</strong> (m.5/2-f, m.5/2-ç).</li>
</ul>

<h2>4. Kimlerle paylaşırız?</h2>
<p>Verilerini <strong>satmayız, reklam için paylaşmayız</strong>. Yalnızca hizmeti çalıştırmak için kullandığımız hizmet sağlayıcılar vardır:</p>
<ul>
<li><strong>Barındırma:</strong> Hetzner (Avrupa Birliği içinde sunucu).</li>
<li><strong>Bildirim:</strong> Google Firebase Cloud Messaging (bildirim kodun ve şifreli bildirim; içeriği okuyamaz).</li>
<li><strong>E-posta gönderimi:</strong> Google Workspace (Google LLC; sunucular ABD ve AB).</li>
<li><strong>Hava durumu:</strong> yalnızca sabit bir ızgara sorgulanır; senin konumun gitmez.</li>
</ul>
<p>Google (ABD) gibi yurt dışındaki sağlayıcılara aktarım KVKK m.9 şartlarına uygun yapılır; bildirimin içeriği şifreli olduğu için sağlayıcı konumunu okuyamaz.</p>
<p>15–17 yaşındaki bir arkadaşının ebeveyni, onun çemberlerindeki kişilerin görünen adlarını görebilir; kullanıcı adlarını, konumlarını, mesajlarını ya da başka bir bilgilerini göremez.</p>
<p><strong>Yetkililer:</strong> Bildirilen bir içerik çocuk istismarı içeriyorsa, o içeriği ve ilgili hesap bilgilerini yasanın gerektirdiği yetkililere iletiriz. Bunun dışında yalnızca yasal bir zorunluluk olduğunda ve elimizde olan kadarını veririz; şifreli içeriği zaten okuyamayız.</p>

<h2>5. Ne kadar saklarız?</h2>
<p>Canlı konum zarfı en çok 24 saat. Mesajlar, fotoğraflar ve hikayeler en çok 24 saat; gönderen silerse hemen silinir ve yedeklere girmez. Bildirilen içerik 90 gün; çocuk istismarında yasanın gerektirdiği süre. Geçmiş (açtıysan) en çok 14 gün. Etkinlik çemberleri bitince silinir. Hesap bilgilerin hesabını silene kadar. Silince hesabın hemen kapanır ve en geç 7 gün içinde sunucudan tamamen kaldırılır; yedeklerden 30 gün içinde düşer. Güvenlik amacıyla tutulan kayıtlar (giriş, yeni telefon, oturum olayları; IP ve konum yok) en çok 90 gün ve 100 olay saklanır.</p>

<h2>6. Hesabını ve verini silme</h2>
<p>Uygulamada: <strong>Ben → Hesap ve veri → Hesabımı sil</strong>. Uygulamaya erişemiyorsan <a href="/hesap">hesap sayfasında</a> e-posta koduyla giriş yapıp hesabını silebilirsin. Silinince çemberlerinden çıkarılır, anahtarların ve fotoğrafın silinir. Çembere eklediğin yerler (ev, okul gibi) çembere aittir ve şifrelidir; sunucu onları kimin eklediğini bilmediği için çemberde kalır. İstersen silmeden önce kendin silebilirsin. Verilerinin bir kopyasını <strong>Ben → Hesap ve veri → Verilerimi indir</strong> ile alabilirsin.</p>

<h2>7. Hakların (KVKK m.11)</h2>
<p>Verinin işlenip işlenmediğini öğrenme, bilgi isteme, düzeltme, silme/yok etme, aktarılan kişileri öğrenme, itiraz ve zarar giderim isteme haklarına sahipsin. support@otenus.com adresine yaz; en geç 30 gün içinde yanıtlarız. Şikâyet için Kişisel Verileri Koruma Kurumu'na (kvkk.gov.tr) başvurabilirsin.</p>

<h2>8. Çocuklar</h2>
<p>Bargu <strong>15 yaşından küçükler tarafından kullanılamaz</strong>. Hesap açarken yaş grubun sorulur; 15'ten küçüksen hesap açılmaz. 15 yaşından küçük birinin hesap açtığını fark edersek hesabı kapatırız.</p>
<h3>15–17 yaş için kısaca</h3>
<ul>
<li>Seni kimse kullanıcı adınla bulamaz. Seni yalnızca QR kodunu ya da davet linkini verdiğin kişiler ekleyebilir.</li>
<li>Yeni katıldığın bir çemberde konumun kapalı başlar; paylaşıp paylaşmamaya sen karar verirsin.</li>
<li>Konum geçmişi senin için kapalıdır.</li>
<li>Bir etkinliğe yalnızca bir arkadaşının QR kodu ya da linkiyle katılabilirsin.</li>
<li>Yalnızca çember üyelerinle yazışabilirsin; ebeveynin mesajlarını ve fotoğraflarını göremez. Her mesajda ve fotoğrafta Bildir ve Engelle vardır.</li>
<li>İstersen bir ya da iki ebeveynini ekleyebilirsin (Ben → Ebeveyn bağlantısı). Bağlantı konum taşımaz: ebeveynin yaş grubunu, bağlantı tarihini, çemberlerindeki kişilerin görünen adlarını, günlük kullanım süreni ve onay isteklerini görür; konumunu, geçmişini, yerlerini, durumunu ve mesajlarını göremez. Ne gördüğünü sen de aynı ekranda görürsün. Bağlantıyı bitirmek istersen ebeveynine haber gider; onaylarsa hemen, onaylamazsa 7 gün sonra biter.</li>
<li>Ebeveynin, yeni biriyle arkadaş olmana, bir gruba veya etkinliğe katılmana ya da birinin senin kodunla veya davetinle yanına gelmesine onay isteyebilir ve günlük bir süre sınırı koyabilir. Sınır dolunca uygulama ertesi güne kadar kapanır; konum paylaşımın sürer, istersen durdurabilirsin. Ücretli işlemler ebeveyn onayı ister. Her değişiklikte haber alırsın.</li>
<li>Reklam, profil çıkarma, öneri ya da herkese açık profil yoktur (zaten kimse için yok).</li>
<li>Yanlış bir yaş grubu seçtiysen ve 18 yaşındaysan bize support@otenus.com adresinden yaz; bir kişi bakar.</li>
</ul>

<h2>9. Güvenlik</h2>
<p>Konum, mesajlar, fotoğraflar ve geçmiş uçtan uca şifrelenir; bağlantılar TLS ile korunur. Mesajlaşma kuralları ve çocuk güvenliği standartlarımız: https://www.otenus.com/bargu/kurallar ve https://www.otenus.com/bargu/cocuk-guvenligi. Hiçbir sistem yüzde yüz güvenli değildir. Telefonunu kaybedersen yeni cihazdan girerek ya da <a href="/hesap">hesap sayfasından</a> eskisini iptal edebilirsin. Güvenlik açığı bildirmek için: support@otenus.com.</p>

<h2>10. Değişiklikler</h2>
<p>Politika değişirse uygulamada ve bu sayfada duyururuz; önemli değişikliklerde yeniden onay isteriz.</p>
</article>

<article lang="en" id="en">
<h1>Bargu Privacy Policy</h1>
<p>Last updated: ${UPDATED}</p>
<p><strong>In short:</strong> Bargu exists to share your location only with people you choose. Your location and messages are encrypted on your phone and our server cannot read them. Messages and photos are deleted after 24 hours. No ads, we do not sell your data, and we never look at your contacts or phone number.</p>

<h2>1. Who is responsible</h2>
<p>Serkan Fidancı (publishing as Otenus), an individual developer in Türkiye. Contact and data requests: support@otenus.com. This person is the data controller under the Turkish Personal Data Protection Law No. 6698 ("KVKK"); this page is also the information notice the law requires.</p>

<h2>2. What we process</h2>
<ul>
<li><strong>Email address:</strong> sign-in and account security (sending your code). No plain address in the database; a keyed hash is stored.</li>
<li><strong>Username, display name, colour, emoji:</strong> so friends can find and recognise you. Stored unencrypted; shown only to relevant people.</li>
<li><strong>Your location:</strong> live location sharing with the circles you pick. End-to-end encrypted on your phone; the server cannot read it; the encrypted form stays at most 24 hours.</li>
<li><strong>Circle history (optional, off by default, based on explicit consent):</strong> the last 14 days of your trail in circles you turn it on for. Encrypted; deleted after 14 days or when you turn it off.</li>
<li><strong>Profile photo (optional):</strong> to show you to friends. Uploaded encrypted; only trusted friends can open it.</li>
<li><strong>Messages, instant photos and stories (optional):</strong> chatting and sharing a photo taken right now with your circle members. End-to-end encrypted; the server cannot read them; deleted from the server and phones after 24 hours. Photos are taken only with the app's camera; their location data (EXIF) is removed. When you open a story, your name and the time go, end-to-end encrypted, only to the person who shared it; the list is deleted after 24 hours. Messages have no read receipts.</li>
<li><strong>Content you report:</strong> preventing abuse and keeping people safe. When you tap "Report", only that message or photo reaches us in readable form; stored encrypted, deleted after 90 days.</li>
<li><strong>Your block list:</strong> so people you block cannot write to you. Kept until you unblock or delete your account.</li>
<li><strong>Places (home, school…) and event data:</strong> arrival notices and planning. Encrypted; events are deleted when they end.</li>
<li><strong>Device keys, notification token (FCM), device check (Play Integrity):</strong> binding your account to your device, sending notifications, blocking fake apps. Private keys never leave your phone; only public keys reach the server.</li>
<li><strong>Usage events (which circle, who wrote to whom and when, notification times):</strong> making the app work and keeping it safe. No content, only type and time; message records are deleted after 24 hours.</li>
<li><strong>Notice, consent and rules records:</strong> when you read this notice, gave or withdrew consent to circle history, and accepted the community rules.</li>
<li><strong>Your age band:</strong> "15–17" or "18 or older", and when you said so. Your birth date or age is never asked or kept. Other users never see your age band.</li>
<li><strong>Your findability setting:</strong> whether others can find you by username. On for 18 and older until you turn it off; always off for 15–17.</li>
<li><strong>Parent links (optional, 15–17):</strong> who is whose parent, when the link was made, and a request to end it; the parent's settings (a yes for new people, a daily limit), requests waiting for a yes (at most 7 days) and how many minutes a day the app was open (last 7 days). All of it is deleted when the last link ends.</li>
</ul>
<p>What we do not use: contacts, phone number, microphone, your photo gallery, advertising ID, analytics or tracking libraries, street addresses. Your IP address is used briefly for rate limiting and is not logged.</p>

<h2>3. Purposes and legal basis</h2>
<ul>
<li>Creating your account and sharing location: <strong>performance of the contract</strong>. Location sharing is the core service. You can turn a circle off or use ghost mode at any time.</li>
<li>Circle history: <strong>explicit consent</strong>, asked on its own screen, distinct from this notice, when you first turn it on; withdraw it at any time (Me → Account and data → Withdraw consent). Withdrawing turns history off everywhere and deletes the copy on the server. The profile photo is optional too; delete it whenever you like.</li>
<li>Messaging and photo sharing are part of the service too: <strong>performance of the contract</strong>.</li>
<li>Security, abuse prevention (including reviewing reported content) and legal duties: <strong>legitimate interest</strong> and <strong>legal obligation</strong>.</li>
</ul>

<h2>4. Who receives it</h2>
<p>We <strong>do not sell</strong> your data and do not share it for ads. Only service providers that run the service: hosting (Hetzner, EU), notifications (Google Firebase Cloud Messaging; content is encrypted, so it cannot read your location), email delivery (Google Workspace, Google LLC; servers in the US and EU), and weather (a fixed grid only; your location is not sent). Transfers to providers outside Türkiye follow KVKK Article 9.</p>
<p>The parent of a friend aged 15–17 can see the display names of the people in that friend's circles; not their usernames, locations, messages or anything else.</p>
<p><strong>Authorities:</strong> if reported content involves child sexual abuse, we pass that content and the related account details to the authorities the law requires. Otherwise we disclose data only when legally required, and only what we hold; we cannot read encrypted content.</p>

<h2>5. Retention</h2>
<p>Encrypted live-location envelope: at most 24 hours. Messages, photos and stories: at most 24 hours; deleted at once if the sender deletes them, and never kept in backups. Reported content: 90 days, or as long as the law requires for child sexual abuse. History (if on): at most 14 days. Event circles: deleted when they end. Account data: until you delete your account. On deletion your account closes at once and is fully removed from the server within 7 days; backups roll off within 30 days. Security records (sign-ins, new phones, session events; no IP address and no location) are kept for at most 90 days and 100 events.</p>

<h2>6. Deleting your account and data</h2>
<p>In the app: <strong>Me → Account and data → Delete my account</strong>. If you cannot open the app, sign in with an email code on the <a href="/hesap">account page</a> and delete your account there. Deletion removes you from circles and deletes your keys and photo. Places you added to a circle (such as home or school) belong to the circle and are encrypted; the server does not know who added them, so they stay in the circle. You can delete them yourself before deleting your account. Get a copy of your data with <strong>Me → Account and data → Download my data</strong>.</p>

<h2>7. Your rights (KVKK Article 11 and, for EU users, GDPR)</h2>
<p>Ask whether your data is processed, request a copy, correct, erase, object, and claim damages. Write to support@otenus.com; we reply within 30 days. You can complain to the Turkish Personal Data Protection Authority (kvkk.gov.tr) or, if you are in the EU, to your local data protection authority.</p>

<h2>8. Children</h2>
<p>Bargu <strong>cannot be used by anyone under 15</strong>. Your age band is asked when you sign up; under 15, no account is opened. If we learn that someone under 15 has an account, we close it.</p>
<h3>If you are 15–17</h3>
<ul>
<li>Nobody can find you by your username. Only people you give your QR code or invite link to can add you.</li>
<li>In a circle you have just joined, your location starts off; you decide whether to share.</li>
<li>Location history is off for you.</li>
<li>You can join an event only with a friend's QR code or link.</li>
<li>You can write only to your circle members; parents cannot see messages or photos. Every message and photo has Report and Block.</li>
<li>If you like, you can add one or two parents (Me → Parent link). The link carries no location: a parent sees your age band, since when you are linked, the display names of the people in your circles, your daily usage time and approval requests; never your location, history, places, status or messages. You see what they see on the same screen. If you want to end the link, your parent is told; it ends at once if they agree, otherwise in 7 days.</li>
<li>Your parent can ask that new friendships, groups or events, and people coming with your code or invitation, wait for their yes, and can set a daily time limit. When it is reached, the app closes until the next day; your location keeps being shared, and you can stop it. Paid purchases need a parent's approval. You are told about every change.</li>
<li>No ads, profiling, suggestions or public profiles (for anyone).</li>
<li>If you chose the wrong age band and are 18, write to support@otenus.com; a person will look at it.</li>
</ul>

<h2>9. Security</h2>
<p>Location, messages, photos and history are end-to-end encrypted; connections use TLS. Our messaging rules and child safety standards: https://www.otenus.com/bargu/kurallar and https://www.otenus.com/bargu/cocuk-guvenligi. No system is perfectly secure. If you lose your phone, signing in on a new device or the <a href="/hesap">account page</a> revokes the old one. Report security issues to support@otenus.com.</p>

<h2>10. Changes</h2>
<p>We announce changes in the app and on this page, and ask again for important ones.</p>
</article>
</main>
</body>
</html>
`;
