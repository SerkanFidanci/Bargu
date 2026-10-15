/**
 * The privacy policy and KVKK information notice (docs/ADR/0022, docs/play-store/
 * GIZLILIK-POLITIKASI.md), served at /gizlilik in Turkish and English. Plain HTML with the account
 * page's stylesheet; nothing from elsewhere. "[…]" marks what the project owner still fills in
 * (data controller, contact) before the Play listing.
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
const UPDATED = '15.10.2026';

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
<p><strong>Kısaca:</strong> Bargu, konumunu yalnızca seçtiğin kişilerle paylaşmak için var. Konumun telefonunda şifrelenir; bizim sunucumuz bile okuyamaz. Reklam yok, verini satmayız, rehberine ya da telefon numarana bakmayız.</p>

<h2>1. Veri sorumlusu</h2>
<p>[Ad Soyad], bireysel geliştirici. Adres: [adres]. İletişim: [destek e-postası]. 6698 sayılı Kişisel Verilerin Korunması Kanunu (KVKK) kapsamında veri sorumlusudur.</p>

<h2>2. Hangi verileri işliyoruz?</h2>
<ul>
<li><strong>E-posta adresi:</strong> giriş ve hesap güvenliği için kod göndermek. Veritabanında düz adres değil, anahtarlı özeti tutulur.</li>
<li><strong>Kullanıcı adı, görünen ad, renk, emoji:</strong> arkadaşlarının seni bulması ve tanıması için. Yalnızca ilgili kişilere gösterilir.</li>
<li><strong>Konumun:</strong> seçtiğin çemberlerle canlı paylaşım için. Telefonunda uçtan uca şifrelenir, sunucu okuyamaz; şifreli hâli en çok 24 saat durur.</li>
<li><strong>Konum geçmişi (isteğe bağlı, kapalı başlar, açık rızaya dayanır):</strong> açtığın çemberde son 14 günün izi. Şifreli; 14 gün sonra ya da kapatınca silinir.</li>
<li><strong>Profil fotoğrafı (isteğe bağlı):</strong> şifreli yüklenir; yalnızca güvendiğin arkadaşların açar.</li>
<li><strong>Yerler ve etkinlik bilgileri:</strong> varış bildirimleri ve buluşma planı için. Şifreli; etkinlik bitince silinir.</li>
<li><strong>Cihaz anahtarları, bildirim kodu, cihaz doğrulaması:</strong> hesabın telefonuna bağlanması, bildirim gönderme, sahte uygulamaları engelleme. Gizli anahtarlar telefondan çıkmaz.</li>
<li><strong>Güvenlik olayları:</strong> girişler, telefon değişimi, çıkış; son 90 gün uygulamada sana gösterilir. IP adresi tutulmaz.</li>
<li><strong>Aydınlatma ve rıza kayıtları:</strong> bu metni okuduğun ve konum geçmişine rıza verdiğin ya da geri çektiğin zaman.</li>
</ul>
<p>Kullanmadıklarımız: rehber, telefon numarası, mikrofon, reklam kimliği, analitik ya da izleme kitaplığı. IP adresi yalnızca hız sınırı için anlık ve takma adla işlenir, kayda geçmez.</p>

<h2>3. İşleme amacı ve hukuki sebep</h2>
<ul>
<li>Hesabı açmak, konum paylaşımı, yerler, etkinlikler, bildirimler ve profil fotoğrafı: uygulamanın sunduğu hizmet, yani <strong>sözleşmenin kurulması ve ifası</strong> (KVKK m.5/2-c).</li>
<li>Konum geçmişi: <strong>açık rıza</strong> (KVKK m.5/1). Geçmişi ilk açarken ayrı bir rıza ekranı gösterilir; rızanı istediğin an geri çekebilirsin (Ben → Gizlilik ve hesap → Rızamı geri çek). Geri çekince geçmiş her çemberde kapanır ve sunucudaki kopyası silinir.</li>
<li>Güvenlik, kötüye kullanımı önleme ve yasal yükümlülükler: <strong>meşru menfaat</strong> ve <strong>hukuki yükümlülük</strong> (m.5/2-f, m.5/2-ç).</li>
</ul>

<h2>4. Kimlerle paylaşırız?</h2>
<p>Verilerini <strong>satmayız, reklam için paylaşmayız</strong>. Yalnızca hizmeti çalıştıran sağlayıcılar vardır: barındırma (Hetzner, Almanya), bildirim (Google Firebase Cloud Messaging; içerik şifreli olduğu için konumunu okuyamaz), e-posta gönderimi ([e-posta servisi, ülke]) ve hava durumu (yalnızca sabit bir ızgara sorgulanır, konumun gitmez). Yurt dışındaki sağlayıcılara aktarım KVKK m.9'a uygun yapılır.</p>

<h2>5. Ne kadar saklarız?</h2>
<p>Canlı konum zarfı en çok 24 saat; konum geçmişi (açtıysan) en çok 14 gün; etkinlik çemberleri bitince silinir; güvenlik olayları 90 gün gösterilir. Hesap bilgilerin hesabını silene kadar tutulur.</p>

<h2>6. Hesabını silme ve verini indirme</h2>
<p>Uygulamada: <strong>Ben → Gizlilik ve hesap → Hesabımı sil</strong>. Uygulamaya erişemiyorsan <a href="/hesap">hesap sayfasından</a> e-postana gelen kodla silebilirsin. Silince hesabın hemen kullanılamaz olur, çemberlerinden çıkarsın (yönettiğin bir grupta yöneticilik en eski üyeye geçer), telefonun kapanır; hesabın ve ona bağlı bütün veriler birkaç dakika içinde, en geç 7 gün içinde kalıcı olarak silinir. Çembere eklediğin yerler o çemberin ortak bilgisidir ve çemberde kalır; istersen silmeden önce kaldırabilirsin. Verilerinin bir kopyasını <strong>Ben → Gizlilik ve hesap → Verilerimi indir</strong> ile alabilirsin.</p>

<h2>7. Hakların (KVKK m.11)</h2>
<p>Verinin işlenip işlenmediğini öğrenme, bilgi isteme, düzeltme, silme, aktarılan kişileri öğrenme, itiraz ve zarar giderim isteme haklarına sahipsin. [destek e-postası] adresine yaz; en geç 30 gün içinde yanıtlarız. Kişisel Verileri Koruma Kurumu'na (kvkk.gov.tr) da başvurabilirsin.</p>

<h2>8. Çocuklar</h2>
<p>Bargu <strong>15 yaşından küçükler tarafından kullanılamaz</strong>. 15–18 yaş için ek kurallar uygulamaya eklendiğinde burada duyurulur. 15 yaşından küçük birinin hesap açtığını öğrenirsek hesabı kapatırız.</p>

<h2>9. Güvenlik</h2>
<p>Konum, fotoğraf ve geçmiş uçtan uca şifrelenir; bağlantılar TLS ile korunur. Telefonunu kaybedersen <a href="/hesap">hesap sayfasından</a> onu hesabından çıkarabilirsin. Güvenlik açığı bildirmek için: [güvenlik e-postası].</p>

<h2>10. Değişiklikler</h2>
<p>Bu metin değişirse uygulamada yeniden gösterilir.</p>
</article>

<article lang="en" id="en">
<h1>Bargu Privacy Policy</h1>
<p>Last updated: ${UPDATED}</p>
<p><strong>In short:</strong> Bargu exists to share your location only with people you choose. Your location is encrypted on your phone; our server cannot read it. No ads, we do not sell your data, and we never look at your contacts or phone number.</p>

<h2>1. Who is responsible</h2>
<p>[Full name], an individual developer. Address: [address]. Contact: [support email]. The data controller under the Turkish Personal Data Protection Law No. 6698 (KVKK); this page is also the information notice the law requires.</p>

<h2>2. What we process</h2>
<ul>
<li><strong>Email address:</strong> sign-in and account security (sending your code). A keyed hash is stored, not the address.</li>
<li><strong>Username, display name, colour, emoji:</strong> so friends can find and recognise you; shown only to relevant people.</li>
<li><strong>Your location:</strong> live sharing with the circles you pick. End-to-end encrypted on your phone; the server cannot read it; the encrypted form stays at most 24 hours.</li>
<li><strong>Location history (optional, off by default, based on explicit consent):</strong> the last 14 days of your trail in circles you turn it on for. Encrypted; deleted after 14 days or when turned off.</li>
<li><strong>Profile photo (optional):</strong> uploaded encrypted; only trusted friends can open it.</li>
<li><strong>Places and event data:</strong> arrival notices and meeting plans. Encrypted; events are deleted when they end.</li>
<li><strong>Device keys, notification token, device check:</strong> binding your account to your phone, sending notifications, blocking fake apps. Private keys never leave your phone.</li>
<li><strong>Security events:</strong> sign-ins, phone changes, sign-outs; the last 90 days are shown to you in the app. No IP address is kept.</li>
<li><strong>Notice and consent records:</strong> when you read this notice and when you gave or withdrew consent to location history.</li>
</ul>
<p>What we do not use: contacts, phone number, microphone, advertising ID, analytics or tracking libraries. Your IP address is used briefly, under a pseudonym, for rate limiting and is not logged.</p>

<h2>3. Purposes and legal basis</h2>
<ul>
<li>Your account, location sharing, places, events, notifications and profile photo: the service the app provides, i.e. <strong>performance of the contract</strong>.</li>
<li>Location history: <strong>explicit consent</strong>, asked on its own screen when you first turn it on; withdraw it at any time (Me → Privacy and account → Withdraw consent). Withdrawing turns history off everywhere and deletes the copy on the server.</li>
<li>Security, abuse prevention and legal duties: <strong>legitimate interest</strong> and <strong>legal obligation</strong>.</li>
</ul>

<h2>4. Who receives it</h2>
<p>We <strong>do not sell</strong> your data or share it for ads. Only providers that run the service: hosting (Hetzner, Germany), notifications (Google Firebase Cloud Messaging; content is encrypted), email delivery ([provider, country]) and weather (a fixed grid only; your location is not sent). Transfers abroad follow KVKK Article 9.</p>

<h2>5. Retention</h2>
<p>Live-location envelope: at most 24 hours. Location history (if on): at most 14 days. Event circles: deleted when they end. Security events: shown for 90 days. Account data: until you delete your account.</p>

<h2>6. Deleting your account and getting your data</h2>
<p>In the app: <strong>Me → Privacy and account → Delete my account</strong>. Without the app, use the <a href="/hesap">account page</a> with a code sent to your email. Your account becomes unusable at once, you leave your circles (in a group you run, the longest-standing member becomes admin), your phone is signed out, and your account and all data tied to it are deleted for good within minutes, at most 7 days. Places you added to a circle belong to that circle and stay; remove them first if you like. Get a copy of your data with <strong>Me → Privacy and account → Download my data</strong>.</p>

<h2>7. Your rights</h2>
<p>Ask whether your data is processed, request information or a copy, correct, erase, object, and claim damages. Write to [support email]; we reply within 30 days. You can also complain to the Turkish Personal Data Protection Authority (kvkk.gov.tr) or, in the EU, your local authority.</p>

<h2>8. Children</h2>
<p>Bargu <strong>cannot be used by anyone under 15</strong>. If we learn that someone under 15 has an account, we close it.</p>

<h2>9. Security</h2>
<p>Location, photos and history are end-to-end encrypted; connections use TLS. If you lose your phone, take it off your account on the <a href="/hesap">account page</a>. Report security issues to [security email].</p>

<h2>10. Changes</h2>
<p>If this text changes, the app shows it to you again.</p>
</article>
</main>
</body>
</html>
`;
