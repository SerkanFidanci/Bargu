# 0008. Tasarım sistemi, harita ve Faz 3 kararları

- Durum: Kabul edildi
- Tarih: 2026-10-13

## Bağlam

Faz 3: tasarım ve hareket değişkenleri, temel bileşenler, `/_dev/ui`, MapLibre + kendi sunucumuzda
Türkiye haritası, ana ekran iskeleti, tanıtım + giriş + kayıt ekranları. Planın açık bıraktığı
marka kararı (renk, yazı tipi) ve bazı kütüphane seçimleri burada netleşti.

## Karar

### Marka (değiştirilebilir)

- **Renk**: ana renk menekşe (`#5B34F2`, koyu temada `#8C6CFF`), vurgu mercan (`#FF6A3D`). Haritada
  avatarlar öne çıksın diye zemin sıcak ve sakin. Tüm metin/zemin çiftleri WCAG AA kontrastını
  sağlıyor; bu bir testle zorunlu (`src/theme/colors.test.ts`), renk değişirse test söyler.
- **Yazı tipi**: başlıklar **Bricolage Grotesque**, metin **Inter**. İkisi de Türkçe harflerin
  hepsini (ğ ş ı İ ç ö ü) ve ₺ işaretini içeriyor (dosyalardan doğrulandı). Uygulamanın içine
  gömülü; çalışırken internetten yazı tipi indirilmez.
- **Simge**: menekşe zemin üzerinde beyaz konum iğnesi, ortasında mercan nokta (bir arkadaş).
  `scripts/build-icons.mjs` kodla çiziyor; açılış ekranı da marka renginde. Gerçek logo gelince aynı
  betikle ya da dosyaları değiştirerek yenilenir.

### Hareket

- Plan §4.2'deki yay ve süre değerleri `src/theme/motion.ts` dosyasında. **ESLint**, bu dosya
  dışında sabit süre, gecikme veya yay değeri yazılırsa hata verir; React Native'in JS
  iş parçacığında çalışan `Animated` / `LayoutAnimation` API'leri yasak. Animasyonlar Reanimated ile
  UI iş parçacığında.
- "Hareketi azalt" açıksa: yaylar anında biter, içeri giren öğeler kaymak yerine solar, sürekli
  döngüler (avatar "nefesi", iskelet titreşimi, tanıtım animasyonları) durur.

### Kütüphaneler (gerekçe ve bakım durumu)

| Paket                                      | Sürüm        | Neden                                                                        |
| ------------------------------------------ | ------------ | ---------------------------------------------------------------------------- |
| `@maplibre/maplibre-react-native`          | 11.5.0       | Planın seçimi; yeni mimariye özel v11, PMTiles'ı yerel okuyor, telemetri yok |
| `@gorhom/bottom-sheet`                     | 5.2.14       | Haritanın üstünde sürüklenen paneller; Reanimated 4 ile UI iş parçacığında   |
| `@tanstack/react-query`                    | 5.104.2      | Sunucu verisinin önbelleği; yoklama ve odakta yenileme kapalı                |
| `zustand`                                  | 5.0.15       | Küçük arayüz durumları (oturum, bildirimler)                                 |
| `lucide-react-native` + `react-native-svg` | 1.55 / 15.15 | Tutarlı simge seti (ISC); SVG Expo 57 ile gelen sürüm                        |
| `expo-haptics`, `expo-font`                | Expo 57      | Titreşim ve gömülü yazı tipleri                                              |
| `@expo-google-fonts/*`                     | 0.4.x        | Yazı tipi dosyaları (OFL); sadece derleme sırasında okunur                   |
| `@protomaps/basemaps` (geliştirme)         | 5.7.2        | Harita stilini üreten betik; uygulamaya girmez                               |
| `@testing-library/react-native` (test)     | 14.1.0       | Ekranları kullanıcı gibi test etmek (rol, etiket, dokunma)                   |

**Kullanılmayanlar**: Skia (metaball ve iz efektleri Faz 6'da gelecek, şimdi gerekmiyor); Rive
(tanıtım kartları için tasarımcının Rive dosyası gerekiyor; kartlar şimdilik SVG + Reanimated ile
çizildi, dosyalar gelince değiştirilebilir); MMKV (kalıcı önbellek Faz 5'te olay akışıyla gelecek).

### Harita: kendi sunucumuzda, üçüncü taraf yok

- Harita karoları, etiket yazı tipleri ve simgeler **kendi sunucumuzdan** (`/map/`) gelir. Bir
  harita sağlayıcısı kullanıcının hangi bölgeye baktığını (yani büyük ihtimalle nerede olduğunu)
  görmez. Bunu bir test zorunlu kılıyor: stil dosyalarındaki her adres bizim sunucuya gidiyor.
- Veri: OpenStreetMap tabanlı **Protomaps** günlük haritasından Türkiye kesiti (yakınlaştırma
  15'e kadar), **tek PMTiles dosyası**; MapLibre bu dosyayı aralık istekleriyle doğrudan okuyor,
  ayrı bir karo sunucusu gerekmiyor (nginx statik dosya). Kurulum: `infra/vps/setup-map.sh`
  (sürümler sabit, indirilen araç SHA-256 ile doğrulanıyor).
- Stil: Protomaps katmanları, Türkçe etiketler, açık/koyu tema için marka renkleriyle
  (`apps/mobile/scripts/build-map-styles.mjs` üretir, çıktı depoda).
- **Görünüm**: harita gündüz açık, 20:00–07:00 arası koyu (plan §4.3 "gece otomatik koyu"); "Ben"
  panelinden Otomatik / Açık / Koyu seçilebilir (yalnızca telefonda saklanır). Koyu tema siyah
  değil, okunur bir gece mavisi.
- **Kaynak gösterimi**: "© OpenStreetMap katkıcıları" harita açılınca altta görünür ve 5 saniye
  sonra kaybolur; lisans bağlantısı "Ben → Harita verisi"nde hep durur. OSMF kaynak gösterimi
  kuralları bu kullanıma izin veriyor (5 saniye sonra katlanma + bulunabilir lisans bilgisi).

### Profil ve kullanıcı adı

- **Kullanıcı adı**: küçük ASCII harf, rakam, `.` ve `_`; 3–20 karakter; başta/sonda/art arda nokta
  yok. Türkçe harfler bilerek dışarıda (herkesin klavyesinde yazılabilsin, benzer görünen
  harflerle taklit zorlaşsın). Servisi taklit eden adlar (`bargu`, `destek`, `admin`, …) noktası
  ve alt çizgisi atılmış halleriyle de yasak. Silinen hesabın adı serbest kalmaz (eski sahibini
  taklit etmek için kullanılamasın).
- **Müsaitlik kontrolü**: yazarken, kısa bir bekleme sonrası; biçim ve yasak adlar telefonda
  anında kontrol edilir, sunucuya yalnızca geçerli adlar sorulur. Sunucu yalnızca evet/hayır döner
  (RLS'i aşan tek `SECURITY DEFINER` fonksiyon) ve hesap başına saatte 120 kontrol sınırı var.
  Kullanıcı adları zaten bulunmak için var; bu sınır toplu taramayı engellemek için.
- **Avatar**: fotoğraf yok. 12 renkten biri + sabit 44 emojiden biri (veya baş harf). Fotoğraf
  sunucuya açık gitseydi sunucu yüzleri görürdü; şifreli fotoğraf ileriki bir fazda.
- Görünen ad: 1–40 karakter, kontrol/yön değiştirme karakteri yok, en az bir görünür harf.

### Ekran akışı

- Oturum yoksa: tanıtım (3 kart) → e-posta → 8 haneli kod (e-postadan otomatik doldurma) →
  kullanıcı adı → ad + avatar → harita. Yönlendirme expo-router "korumalı rotalar" ile: oturum ve
  profil durumu değişince doğru bölüm kendiliğinden açılır.
- Uygulama açılışta sunucuya ulaşamazsa "Bağlanıyor…" ekranı gösterir ve kendi kendine artan
  aralıklarla (en çok 10 sn) tekrar dener; yenile düğmesi yok (CLAUDE.md).
- Çıkışta cihaz anahtarları silinir (sunucuya ulaşılamasa bile); tekrar girişte yeni anahtar
  üretilir. Sunucu oturumu bitirirse (başka telefondan giriş) uygulama da yerelde kapanır.
- Ana ekranda "Seni kimse görmüyor" yazısı şu an gerçek: henüz paylaşım yok. Hayalet modu düğmesi
  ve hassasiyet ayarı, gerçekten bir şey yaptıkları Faz 5'te eklenecek (yanıltıcı düğme yok).

## Sonuçlar

- Yeni bağımlılıklar yukarıdaki tabloda; lockfile ve Renovate ile izleniyor.
- Harita yalnızca Türkiye'yi kapsıyor; yurt dışında harita boş görünür (açık risk, DURUM.md).
- Faz 3 DoD'deki "iPhone SE" ölçümü, Apple hesabı ve iPhone gelene kadar Android'de küçük ekran ve
  en büyük yazı boyutuyla yapılıyor.

## Ek (2026-10-16, proje sahibinin isteği: haritada kişiler)

- **Çıkartma ve ada:** Haritada kişi artık iğne değil. Avatarı kalın beyaz kenarlı bir çıkartma
  (kâğıt beyazı, iki temada da) ve her kişi kendine özgü, sabit bir açıyla hafif eğik duruyor;
  açı kişinin kimliğinden türetilir (`ui/sticker.ts`). Çıkartmanın biraz altında, kişinin renginde
  küçük bir ada var; adanın ortası tam konum. Konum canlıyken ve kişi dururken çıkartma hafifçe
  kalkıp iner, ada altında küçülür. Yürürken ve koşarken adım hareketi, bisiklette sallanma,
  araçta titreşim sürer; bir yerde uzun kalınca adadan yavaş bir halka yayılır. Pil, şarj ve eski
  konum işaretleri aynen kalır (eski konumda çıkartma ve ada gri, yaş adanın altında). Proje
  sahibi üç sıradan iğne önerisini istemedi ("sıradan bir şey yapma"); üç yaratıcı yönden
  (çıkartma ve ada, jöle damla, ışık huzmesi) bunu seçti. Ölçüler `stickerFx` (theme/motion.ts).
- **Birlikte duranlar:** Kullanıcının kendi avatarı da artık yakındakilerle kümelenir; önceden
  kümeye girmediği için bir arkadaşın avatarının üstüne biniyordu. Birbirine değecek kadar yakın
  olanların adaları sıvı gibi tek adaya akar (Skia "goo"). Avatarlar tek bir ortak çıkartma
  çerçevesinde toplanır: beyaz bir kapsül, kenarındaki ince halka bir kişinin renginden ötekinin
  rengine geçer, çerçeve grubun kendine özgü açısıyla hafif eğiktir. Çerçevede en çok iki avatar
  vardır (proje sahibi: "2'si tek çerçevede toplansın"). Sıra sabittir: ötekiler, en sonda
  kullanıcı; kullanıcı oradaysa hep görünür (`capsuleOf`, features/map/cluster.ts). İki kişide
  her avatara ayrı ayrı dokunulur, basılı tutulur. Daha fazla kişide çerçevenin sağ üst köşesinde
  oradaki toplam kişi sayısı yazar; çerçeveye dokununca oradaki herkes bir pencerede listelenir ve
  birine dokununca onun kartı açılır (`TogetherSheet`). Önceki "dokununca yakınlaş" kalktı.

## Ek (2026-10-18, proje sahibinin isteği: tema)

Proje sahibi uygulamanın yeniden çizilmiş iki ekranını gönderdi ("temayı bu şekilde düzenle"); PM
onayladı (sunucu değişmez, dilim 3b'den önce).

- **Renkler:** koyu tema nötr siyahtan lacivert-mora geçti (arka `#0F0E22`, yüzey `#17152D`,
  yükseltilmiş `#1F1C3A`, mor tonlu kenar `#36305E`). Mor `#7A55F6` oldu, üstündeki yazı beyaz.
  Açık temanın karşılığı: hafif mor tonlu yüzey `#F5F3FF`, mor tonlu kenar `#E2DDF5`. Her
  yazı/zemin çifti WCAG AA'yı geçer (`colors.test.ts`).
- **Parıltı:** seçili ve birincil öğelerin çevresinde durağan, mor bir gölge (`ColorTokens.glow`,
  `useGlow`): seçili seçenek ve "+" düğmesi. Hiç hareket etmez; sade mod "kapalı"da yoktur
  (ADR 0027).
- **Hap ve kartlar:** haplar, dock, kısayollar ve kartlar ince mor tonlu kenarlıklı. Ben sayfasında
  ilişkili satırlar tek kartta, aralarında ince çizgi; açan satırlarda ">" var.
- **"Seni görüyor" hapı:** iki satır ve ">". İkinci satır gerçek durumu söyler (güvenlik metni,
  testli): yalnızca konum gerçekten giderken "Konumun şu an paylaşılıyor"; hayalet "Gizle"de
  "gizli", "Dondur"da "donduruldu", gören yoksa "kimseyle paylaşılmıyor", konum izni yoksa "izin
  yok". Haritada hava kartıyla yan yana; dar ekranda ya da büyük yazıda hava alta geçer.
- **Hava kartı:** "☁ 12°" ve altında telefonun çevresindeki ilçe ya da kasaba adı. Ad haritanın
  kendi çizdiği etiketlerden çıkar, ağa istek yok (ADR 0013). Sokak yakınlığında haritada şehir
  etiketi çizilmediği için çoğu zaman ilçe adı ("Kadıköy") görünür; yakında etiket yoksa yalnızca
  sıcaklık.
- **Seçim çubukları:** seçeneklerin yanında simge var (hayalet: hayalet, duraklat, göz kapalı;
  harita görünümü: harita, güneş, ay; efektler: yıldızlar, yıldız, yasak). Anlam her zaman
  yazıdadır. Açıklama satırlarının başında ⓘ var (`Hint`).
- **Dock:** bulunulan yer mor yazı ve altında mor çizgiyle işaretli: haritada ve çemberlerde
  "Çemberler", Ben sayfası açıkken "Ben". Ekran okuyucu bunu seçili olarak okur.
- **Kişi işaretleri: çıkartma ve ada, pinle değişti (sahip, 2026-10-18).** Kişinin avatarı mor
  halkalı bir dairede (konumu eskiyse gri), kısa bir uç aşağıdaki konum noktasına iner; konum
  tazeyken dairenin sağ altında yeşil "canlı" noktası var. Eğik beyaz çıkartma ve renkli ada
  kalktı. Etkinlik çizimi sağ üstte, şarj şimşeği sol altta, düşük pil kırmızı halkası, eskime
  ("23 sa", gri), hız ve durma etiketi, hayalet hâli aynen kaldı; hareketler sade mod kurallarıyla
  (ADR 0027). Birlikte duranlar tek ortak pinde: en çok 2 avatar aynı mor halkada, her biri ayrı
  dokunulur, fazlası sağ üstte sayı, dokununca liste (önceki "goo" adası ve eğiklik kalktı).
  Dilim 3'ün süs paketleri buna göre değişecek (3b'de, PM): "Halka desenleri" ve "Pin
  çerçeveleri".
- **Hayalet düğmesindeki mor nokta (sahip, 2026-10-18):** "konumun paylaşılıyor". Yalnızca konum
  gerçekten birine giderken görünür ("seni görüyor" hapının ikinci satırıyla aynı hesap): hayalet
  (gizle ya da dondur), bütün çemberler duraklamış ya da paylaşım kapalı (gören yok) ya da konum
  izni yokken kalkar. Ekran okuyucu "Konumun paylaşılıyor." der. Bir güvenlik göstergesi, testli.
- **Göstergeler gerçeği geç söylemez (QA 24):** konum izni henüz bilinmezken (uygulama yeni
  açılmış) hap "Kontrol ediliyor…" der ve nokta görünmez; "paylaşılıyor" yalnızca izin verilmişken.
  Zamanlı bir paylaşım bittiği anda tek bir zamanlayıcı hem konum motorunu durdurur hem ekranların
  saatini günceller: hap ve nokta yarım dakikalık saat vuruşunu beklemez. Hava kartındaki ilçe adı
  bulunduğu yaklaşık 1 km'lik kareyle saklanır; başka bir kareye geçilince eski ad görünmez.
- **Kontrast (QA 24):** koyu temada mor simge ile açık mor zemini (`primarySoft` `#28214F`) 3:1'in,
  açık temada hata rengi (`danger` `#CC2A1E`) yüzey üstünde 4,5:1'in üstünde; ikisi de testte.

## Ek (2026-10-21, proje sahibinin isteği: gerçekçi hareket çizimleri)

Sahip yürüyen, koşan ve araçtaki kişilerin çizimini daha gerçekçi istedi. Araba 120 km/sa'i geçince
yarış arabasına dönsün, sürat animasyonu çıksın dedi. Önizlemeyi beğendi ("güzel beğendim"). PM'in
korkulukları:

- **Çizimler (`ui/activity-glyph.tsx`):**
  - Yürüyen ve koşan insanın dizi ve dirseği bükülür; koşan öne eğilir ve bir an iki ayağı da
    havadadır.
  - Gövde her adımda iner kalkar; alttaki ayak hep yerdedir (`activity-glyph-pose.ts`, testli).
  - Bisikletlinin ayağı pedalda kalır, diz önde.
  - Arabanın tekerlekleri hıza göre döner, çok hızlıyken jant bulanıklaşır, yol çizgileri hızla
    akar.
  - Şehir içinde (70 km/sa altı) egzoz dumanı, yolda hava çizgileri.
  - Gömlek, araba, trenin şeridi ve uçağın kuyruğu kişinin kendi renginde.
- **Eşikler (`activityFx.speeds`):**
  - 120 km/sa'ten yarış arabası ve düz hız çizgileri;
  - 200 km/sa'ten hızlı tren;
  - 300 km/sa'ten uçak.
  - Telefon trende mi uçakta mı bilemez; hızdan tahmin edilir.
- **Korkuluklar (PM):**
  - Yarış arabası, tren ve uçak yalnızca hız bilgisiyle gelir. Hız da yalnızca "Hızımı göster"
    açıkken ve konum tam paylaşılırken gönderilir; hız yoksa çizim yok.
  - Kişinin kendi pininde de hız gösterilmiyorsa en fazla araba çizilir.
  - Hız kutlanmaz: ses, konfeti, rozet yok. Pinin arkasındaki noktaların yerinde düz çizgiler var.
  - Sade moda uyar (ADR 0027): "az"da her yeni konumda bir tur, "kapalı"da hareketsiz. Boştaki kare
    testi (`idle-frames.test.tsx`) yeni çizimleri de kapsıyor: "az" ve "kapalı"da 0 kare.
- **Rozet:**
  - Yaya için yuvarlak (34 px).
  - Tekerlek, ray ve kanat için geniş (54 × 33 px), dairenin sağına uzanır.
  - Ortak pinde yer olmadığından hep yuvarlak.
- **Nasıl çiziliyor:**
  - İnsanlar eklemli View çubukları, tek dönüşlerle.
  - Araç gövdeleri bir kez çizilen sabit SVG'ler (react-native-svg, bağımlılık zaten vardı).
  - Tekerlek, yol, duman, hava, bulut ve hız çizgileri UI thread'de dönen ya da kayan View'lar.
  - Her hareket pinin kendi döngüsünden okunur ve döngünün sonunda başa sarar; JS thread'de hiçbir
    şey çizilmez.
