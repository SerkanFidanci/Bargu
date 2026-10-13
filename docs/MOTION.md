# Hareket ve tasarım kuralları

Kaynak: BARGU_PLAN §4. Kod: `apps/mobile/src/theme/`. Kararlar: [ADR 0008](ADR/0008-design-system-and-map.md).

## Hareket değişkenleri (`motion.ts`)

| Ad              | Değer                               | Nerede                                             |
| --------------- | ----------------------------------- | -------------------------------------------------- |
| `spring.snappy` | damping 20, stiffness 300, mass 0.8 | Basma geri bildirimi, anahtar, kaydırıcı, paneller |
| `spring.bouncy` | damping 12, stiffness 180, mass 1   | Oyuncu anlar (kilit kapanması, dürtme)             |
| `spring.gentle` | damping 26, stiffness 120, mass 1   | Büyük ve sakin geçişler (hassasiyet halkası)       |
| `duration`      | fast 150 · base 250 · slow 400 ms   | Solma ve kısa geçişler; hiçbiri 400 ms'yi aşmaz    |
| `ambient`       | nefes 2400 ms · titreşim 900 ms · … | Kendi kendine dönen süsler (kullanıcıyı bekletmez) |
| `haptic`        | select · success · bump             | Seçim, başarı, dürtme                              |

Kurallar:

1. Animasyonlar Reanimated ile UI iş parçacığında. React Native `Animated` / `LayoutAnimation`
   yasak (ESLint).
2. Süre, gecikme ve yay değerleri yalnızca `motion.ts` içinde; başka yerde sayı yazmak ESLint hatası.
   Hedef değerler (opaklık 0 → 1, kaydırma mesafesi) veridir, serbesttir.
3. React Compiler açık: paylaşılan değerler `.get()` / `.set()` ile okunur/yazılır.
4. **Hareketi azalt**: tüm yay ve süreler `ReduceMotion.System` taşır (anında biter); içeri giren
   öğeler `useMotion()` ile kaymak yerine solar; döngüler durur.
5. Her dokunulabilir öğenin bir basma geri bildirimi (hafif küçülme) ve gerektiğinde titreşimi var.

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
