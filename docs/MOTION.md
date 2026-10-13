# Hareket ve tasarım kuralları

Kaynak: BARGU_PLAN §4. Kod: `apps/mobile/src/theme/`. Kararlar: [ADR 0008](ADR/0008-design-system-and-map.md).

## Hareket değişkenleri (`motion.ts`)

| Ad              | Değer                                                                               | Nerede                                                                      |
| --------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `spring.snappy` | damping 20, stiffness 300, mass 0.8                                                 | Basma geri bildirimi, anahtar, kaydırıcı, paneller                          |
| `spring.bouncy` | damping 12, stiffness 180, mass 1                                                   | Oyuncu anlar (kilit kapanması, dürtme)                                      |
| `spring.gentle` | damping 26, stiffness 120, mass 1                                                   | Büyük ve sakin geçişler (hassasiyet halkası)                                |
| `duration`      | fast 150 · base 250 · slow 400 ms                                                   | Solma ve kısa geçişler; hiçbiri 400 ms'yi aşmaz                             |
| `ambient`       | nefes 2400 ms · titreşim 900 ms · tarama çizgisi 1800 ms · QR halesi 2000 ms · …    | Kendi kendine dönen süsler (kullanıcıyı bekletmez)                          |
| `choreography`  | sıra arası 60 ms · hane grubu 35 ms · büyüme 1,14 · titreme 3×8 pt · paralaks · 45° | Sırayla giriş, güvenlik numarası, kod kutuları, seçimler, tanıtım, alt menü |
| `haptic`        | select · success · bump                                                             | Seçim, başarı, dürtme                                                       |

Kurallar:

1. Animasyonlar Reanimated ile UI iş parçacığında. React Native `Animated` / `LayoutAnimation`
   yasak (ESLint).
2. Süre, gecikme ve yay değerleri yalnızca `motion.ts` içinde; başka yerde sayı yazmak ESLint hatası.
   Hedef değerler (opaklık 0 → 1, kaydırma mesafesi) veridir, serbesttir.
3. React Compiler açık: paylaşılan değerler `.get()` / `.set()` ile okunur/yazılır.
4. **Hareketi azalt**: tüm yay ve süreler `ReduceMotion.System` taşır (anında biter); içeri giren
   öğeler `useMotion()` ile kaymak yerine solar; döngüler durur.
5. Her dokunulabilir öğenin bir basma geri bildirimi (hafif küçülme) ve gerektiğinde titreşimi var.

## Nerede ne hareket ediyor

| Yer               | Hareket                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| Butonlar          | Basınca küçülür, bırakınca yaylanır; birincil butonda ışık süzülür; yükleniyor işareti zıplayarak gelir |
| Form ekranları    | Başlık, metin, alanlar ve buton sırayla aşağıdan kayarak gelir                                          |
| Tanıtım kartları  | Çizimler animasyonlu; kaydırırken resim ve yazı farklı hızda kayar (paralaks), uzaklaşınca solar        |
| Kod girişi        | Her rakamla kutu zıplar; yanlış kodda satır titrer ve hata titreşimi                                    |
| Kullanıcı adı     | Kontrol sırasında dönen işaret, sonra zıplayan ✓ / ✕                                                    |
| Avatar seçimi     | Seçilen renk/emoji büyür, önizleme işaretçisi her değişiklikte zıplar                                   |
| Harita ekranı     | Üst balon yukarıdan, alt menü aşağıdan gelir; + düğmesi panel açıkken ×'e döner; avatar "nefes alır"    |
| Paneller          | Yay ile açılır; satırlar sırayla gelir                                                                  |
| Bildirimler       | Üstten yaylanarak iner, yukarı çıkarak kaybolur                                                         |
| Boş durum         | Simge zıplayarak gelir ve hafifçe süzülür                                                               |
| Kayıt bitişi      | Harita açılırken kısa bir konfeti (dokunmayı engellemez)                                                |
| Arkadaşlık        | İstek kabul edilince, QR okutulunca ve güvenlik numarası eşleşince konfeti + başarı titreşimi           |
| QR kod            | Kart zıplayarak gelir, arkasında hale yavaşça büyüyüp söner                                             |
| QR tarayıcı       | Köşeli çerçevede çizgi yukarı aşağı tarar; yanlış kodda hata titreşimi ve kısa uyarı                    |
| Güvenlik numarası | 12 hane grubu sırayla zıplayarak belirir; hesaplanırken iskelet nabız atar                              |
| Durum rozetleri   | "Şifreli", "Bekliyor", "Doğrulandı" rozetleri değişince zıplar                                          |

Gösterişli harita animasyonları (hız izi, sıvı gibi birleşen avatarlar, radyal menü, dürtme, buluşma
efekti) plana göre Faz 6'da.

## Tasarım değişkenleri

- **Renk** (`colors.ts`): açık ve koyu tema; her metin/zemin çifti WCAG AA (test zorunlu). Avatar
  paleti 12 renk, üzerinde beyaz baş harf okunur.
- **Yazı** (`typography.ts`): display / title1 / title2 (Bricolage Grotesque) ve headline / body /
  callout / subhead / footnote / caption (Inter). Sistem yazı boyutunu izler; her ölçünün bir üst
  sınırı var ki en büyük erişilebilirlik boyutunda küçük ekranda düzen bozulmasın.
- **Boşluk** (`layout.ts`): 4'lük ızgara (2, 4, 8, 12, 16, 24, 32, 48). Köşe: 8 / 12 / 20 / 28 /
  hap. Dokunma alanı en az 48.
- **Gölge**: `raised` ve `floating` (CSS box-shadow, yeni mimari).

## Bileşenler (`src/ui/`)

Button, IconButton, Pill, Toggle, StepSlider, Toast, EmptyState, Skeleton, Avatar, AvatarStack,
AvatarMarker, Sheet, TextField, CodeInput, Text. Hepsi geliştirici galerisinde (`/_dev/ui`,
"Ben" panelinden açılır), kare hızı ölçerle birlikte.

Erişilebilirlik: her bileşenin rolü ve etiketi var (buton, anahtar, ayarlanabilir kaydırıcı,
radyo grubu, uyarı); kod girişi tek etiketli alan olarak okunur; avatar yığını tek cümle okunur.
