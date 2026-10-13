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
