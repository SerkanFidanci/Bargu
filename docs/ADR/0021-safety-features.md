# 0021. Güvenlik özellikleri: hatırlatma, yeni izleyici, tümünü durdur, kilit, olaylar, uzaktan iptal

- Durum: Kabul edildi
- Tarih: 2026-10-15

## Bağlam

BARGU_PLAN Faz 9 dilim 3; tehdit modelindeki "kontrolcü partner" ve "çalınan telefon" satırları.
Proje sahibi dört soruda da öneriyi seçti (PM üzerinden, 2026-10-15). Telefon denemesinde
buluşmanın bir arkadaşla kolayca başlatılamadığını söyledi; kişi kartından başlatmayı seçti.

## Karar

- **Haftalık hatırlatma:** konumu ya da konum geçmişini gören biri varken 7 günde bir. İki
  biçimde gelir:
  - haritada bir kart, örneğin "Konumunu 5 kişi görüyor (Aile 3, Ekip 2); konum geçmişini 2 kişi
    görüyor", "Tamam" ve "Düzenle" düğmeleriyle;
  - telefonun kendi kurduğu yerel bildirim. Bildirim genel bir cümledir; kilit ekranında isim ve
    sayı görünmez.

  Sunucuya ya da bildirim servisine bir şey gitmez. Sayaç ilk açılışta başlar; "Tamam" ya da
  "Düzenle" yeni bir hafta başlatır. Kimse bir şey görmüyorsa bildirim kurulmaz, varsa geri alınır.
  Android'de ayrı bir kanalı var ("Gizlilik hatırlatmaları"): arkadaş haberleriyle birlikte
  susturulmasın diye.

- **Yeni izleyici:** paylaşılan bir gruba yeni biri girince "X artık Aile çemberinde konumunu
  görebilir" denir. Geçmiş de açıksa tek cümleyle "konumunu ve konum geçmişini" denir.
  - Söylenmeyen durumlar: arkadaşlık (kendi bildirimi var), ilk bakış (yeni katılınan çember) ve
    paylaşılmayan çember. Paylaşmaya başlamak kullanıcının kendi seçimidir ve çemberde kimin
    olduğunu görerek yapılır.
  - Bu kişi için genel "X katıldı" duyurusu ikinci kez gösterilmez.
  - Uygulama kapalıyken sunucunun "yeni biri katıldı" bildirimini telefon (Android) ya da iOS
    uzantısı bu bilgiye göre yazar. Uzantıya, canlı konumu gören çemberlerin kimlikleri de verilir
    (çember kimlikleri orada zaten vardı). Liste açılışta da yazılır (QA B3).
- **Tümünü durdur:** hayalet modunun "gizle" hâli. Konum herkesin haritasından hemen kalkar, konum
  gönderilmez, geçmiş yazılmaz (bekleyen parçalar atılır, ADR 0019). "Seni görenler" ekranında
  durur; haritadaki "kim görüyor" hapı bu ekranı açar. Ekran çember çember kimlerin gördüğünü ve
  hangi ayrıntıda gördüğünü gösterir. "Paylaşmaya devam et" tek dokunuştur. "Geçmişimi de sil"
  ayrıca onay ister: bütün çemberlerde geçmiş kapanır ve sunucudaki kopya silinir.
- **Uygulama kilidi:** varsayılan kapalı, "Ben → Güvenlik"ten açılır. Açıksa uygulama açılışta ve
  1 dakikadan uzun arka planda kaldıktan sonra Face ID, parmak izi ya da telefon şifresi ister.
  - Yalnızca "arka plan" sayılır; sistemin kendi Face ID penceresi uygulamayı kısa süre "pasif"
    yapar, o sayılmaz.
  - Kilit yalnızca ekranı korur, paylaşım arkada sürer. Bildirimleri gizlemez; içerikleri zaten
    mühürlüdür (ADR 0016).
  - Açmak da kapatmak da telefonun doğrulamasını ister: kilidi açık telefonu eline alan biri kilidi
    sessizce kapatamaz.
  - Ayar şifreli kasada tutulur. Kasa açılınca, ekranda hiçbir şey çizilmeden önce okunur.
  - Kilitliyken uygulamanın ekranları hiç çizilmez, yalnızca kilit ekranı vardır (QA 3a-B2). Böylece
    ekran okuyucu (TalkBack) altta bir şey okuyamaz ve iOS'ta tam ekran açılan bir pencere kilidin
    üstüne çıkamaz. Bedeli: kilidi açınca uygulama haritadan başlar.
  - Kilit ekranı telefonu açılınca ve uygulama arka plandan dönünce kendiliğinden sorar. "Vazgeç"ten
    sonra yalnızca düğme yeniden sorar; sistemin Face ID penceresinin kısa "pasif" hâli yeni bir soru
    açmaz.
  - Yeni bağımlılık: **expo-local-authentication 57.0.3**.
    - Expo'nun resmî paketidir, Expo SDK 57 ile aynı sürüm hattındadır ve bakımı Expo ekibindedir.
    - Telefonun yerel doğrulamasını kullanır (iOS LocalAuthentication, Android BiometricPrompt ve
      cihaz şifresi).
    - Ağa çıkmaz, bir sır saklamaz, yalnızca "evet / hayır" döndürür.
    - `npx expo install` ile eklendi. iOS'ta Face ID izin metni tr/en.
- **Güvenlik olayları:** `GET /v1/me/security-events` hesabın kendi olaylarını döndürür. Kapsam:
  - Olaylar: girişler, yeni telefonun eskisinin yerine geçmesi, şüpheli oturum kullanımı, geçiş
    anahtarı ve çıkış.
  - Son 90 gün, en çok 100 olay.
  - Telefonun türü ve bu telefon olup olmadığı gösterilir. IP ya da yer yok; sunucu tutmuyor.
  - Telefon tanımadığı yeni olay türlerini atlar; liste bozulmaz.
  - Eski olayların silinmesi dilim 4'te, KVKK saklama süreleriyle birlikte.
- **Kişi kartından buluşma ("Buluş"):** tek dokunuşla o arkadaşla 3 saatlik bir etkinlik kurulur
  ve arkadaşa davet gider. Etkinliği kuran yöneticidir (ADR 0020), saati ve yeri hemen seçer. Bitince
  her şey silinir (ADR 0017). Uzun basınca açılan menü 5 öğe için ayarlı, oraya eklenmedi.
  Onaydan sonra kart kapanır ve bir kurulum bitmeden ikincisi başlamaz. Davet gitmezse etkinlik
  hemen bitirilir ve "davet gitmedi" denir: arkadaşsız bir buluşma kalmaz (QA 3a-B1).
- **"Paylaşmaya devam et":** "Tümünü durdur"dan önceki hayalet hâline döner. Öncesinde "dondur"
  açıksa yine "dondur" olur (QA 3a-B4).
- **Uzaktan cihaz iptali:** API'nin geçici alan adında `/hesap` web sayfası. Akış:
  - E-posta yazılır, e-postayla gelen 8 haneli kod girilir, "Telefonumu hesaptan çıkar"
    denir. Telefonun "Ben → Güvenlik" ekranı bu adresi gösterir.
  - Kod girişteki 4 haneli koddan ayrıdır: `bargu/v1/web-code` etiketiyle türetilir
    (PROTOCOL.md), yalnızca bu sayfada geçer ve sayfanın sekme için ürettiği rastgele değere
    (binding) bağlıdır.
  - Kendi sınırları vardır. Bütçeler adres ve ağ (IPv4 ya da IPv6 /64, takma adla) başına
    tutulur; yalnızca adresi bilen biri, sahibin kendi ağından girmesini engelleyemez (QA 3b N1):
    - kod istekleri: adres+ağ başına saatte 3, günde 10; adres başına (bütün ağlar) günde 50;
    - kod başına 3 deneme; yanlış kod adres+ağ başına günde 10, adres başına (bütün ağlar) günde 150.
      Bu tavanla tahmin şansı günde 1,5·10⁻⁶;
    - ağ başına saatte 10 kod isteği, 30 doğrulama, 10 iptal ve 10 silme.
    - E-posta kuyruğa beklenmeden yazılır; hesabı olan ve olmayan adres aynı sürede cevap alır
      (QA 3b N3).

    Girişin hakları tüketilmez; hesap sayfasında yanlış kod denemek girişi kilitlemez. Olmayan bir
    hesaba e-posta gitmez, ama cevaplar (kod isteme ve kod denetleme) hesap olsun olmasın aynıdır.

  - Doğrulanan kod 10 dakikalık, tek işlemlik bir oturum verir; sayfa bu sürede hesapta hangi tür
    telefon olduğunu ve ne zamandan beri olduğunu gösterir.
  - Sayfa sunucunun kendisinden gelir; betik ve stil de oradan, dışarıdan hiçbir şey yüklenmez.
    Sıkı içerik politikası (CSP) vardır, başka sitede çerçeve içinde açılamaz, önbelleğe alınmaz.
    Başka sitelerden gelen tarayıcı istekleri zaten reddedilir (CSRF koruması).
  - 10^8 kod ve günde birkaç yanlış denemeyle tahmin şansı fiilen yoktur. ADR 0012'nin 4 haneli
    kod riski bu sayfaya taşınmaz. Bu, dilim 4'te aynı sayfaya eklenecek hesap silme için de
    gereklidir.
  - İptal edince eski telefonun oturumu, yenileme anahtarları ve bildirim kaydı hemen kapanır,
    çemberler yeni anahtara geçer. Telefon bir sonraki bağlanışında kendini kapatır ve kasasını
    siler. Olay listesine "Telefon web sayfasından çıkarıldı" yazılır.

## Sonuçlar

- Sunucu hiçbir yeni şey öğrenmez: hatırlatma, yeni izleyici, kilit ve "tümünü durdur" telefonda
  çalışır. "Tümünü durdur" sunucuya yalnızca konumun geri çekildiğini söyler (zaten kabul edilen
  sızıntı: "Konumu geri çekme").
- Kilit, telefon kilidi açıkken elinde tutan birine karşı uygulamayı korur. Telefonun kendi
  kilidinin yerine geçmez.
- Yeni izleyici uyarısı yalnızca bu telefonun bildiği üyelere göre çalışır. Bir üye, telefon
  çevrimdışıyken girip çıkarsa söylenmez; o sürede kimse yeni konum almaz.
