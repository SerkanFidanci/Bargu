# Bargu Kod ve Güvenlik Tarama Raporu

> **PM notu (2026-10-21):** Bu rapor depo dışında çalıştırılan bir GPT taramasının çıktısıdır; PM bulguları kilit dosyası ve `pnpm audit` ile doğruladı. `decode-uri-component` uygulamada çalışıyordu (expo-router bağlantı ayrıştırması); gelen bağlantı süzgeci eklendi (`51b3cb9`) ve QA 26 onu 200 000 zararlı girdiyle denedi. `uuid` yalnızca iOS proje araçlarında, uygulamaya girmiyor. Doğrulanan kullanılmayan kod temizlendi (`b4bb890`). Ayrıntı: [BARGU_PLAN.md](../../BARGU_PLAN.md) Faz 10, "Dış tarama notları". Rapordaki satır bağlantıları tarama anındaki koda göredir.

**Tarih:** 21.10.2026  
**Kapsam:** `apps/`, `packages/`, `infra/`, `scripts/`, bağımlılık kilit dosyası ve depo kökündeki kalite kontrolleri.  
**Yöntem:** ESLint, TypeScript, Prettier, görünmez karakter denetimi, Knip, `pnpm audit`, mevcut birim ve entegrasyon testleri. Kaynak kod değiştirilmedi.

## Özet

| Alan                          | Sonuç                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------- |
| ESLint / güvenlik kuralları   | Hata yok                                                                     |
| TypeScript                    | 4 çalışma alanı kontrolü başarılı                                            |
| Birim ve entegrasyon testleri | **1.077 geçti, 0 başarısız**                                                 |
| Crypto kapsamı                | Satır, dal, fonksiyon ve ifade kapsamı **%100**                              |
| Biçim / görünmez karakter     | Kontroller geçti                                                             |
| Bağımlılık güvenliği          | **2 orta seviye bulgu**, ayrıca yapılandırmada yok sayılan 2 yüksek advisory |
| Kullanılmayan kod             | Knip, **123 export ve 16 export edilmiş türü** aday olarak işaretledi        |

## Bulgular

### Orta — bağımlılık açıkları

`pnpm audit --prod` kilit dosyasındaki üretim bağımlılık ağacında iki orta seviye advisory buldu:

| Paket ve kilitli sürüm           | Bağımlılık yolu                                          | Etki ve advisory                                                                                                                                                                                                               |
| -------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `uuid` **7.0.3**, **8.3.2**      | Expo/Xcode yapılandırma zinciri; `@bacons/apple-targets` | `buf` sağlanan v3/v5/v6 işlemlerinde buffer sınırı kontrolü eksik. Etkilenen sürümler `<11.1.1`. [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq). Kilit dosyası: `pnpm-lock.yaml:6986`.               |
| `decode-uri-component` **0.2.2** | `expo-router > query-string`                             | Bozuk yüzde kodlamalı girdilerle hizmet engelleme riski. Etkilenen sürümler `<=0.4.2`; yamalı sürüm `>=0.5.0`. [GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr). Kilit dosyası: `pnpm-lock.yaml:3641`. |

İlk bulgunun zinciri ağırlıklı olarak Expo/Xcode yapılandırma ve build araçlarından geçiyor; uygulama çalışma zamanında erişilebilirliği bu taramada ayrıca doğrulanmadı. İkinci bulgu Expo Router’ın URL sorgusu çözümleme zincirinde. Güncelleme/override seçimi Expo sürüm uyumluluğu incelenerek yapılmalı.

### Yüksek — audit yapılandırmasında yok sayılan advisory’ler

Denetim, `pnpm-workspace.yaml` içindeki istisnalar nedeniyle iki yüksek advisory’yi yok sayılmış olarak bildirdi. GitHub Advisory Database kontrolünde ikisi için de yamalı sürüm yayımlanmamış görünüyordu:

- `node-forge` RSA imza doğrulama açığı, **CVE-2026-85393** ([GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv)). Depo notu, Expo CLI/build aracılığıyla geldiğini ve uygulamaya paketlenmediğini belirtiyor.
- `braces` iç içe parantez girdileriyle yığın taşması/DoS açığı, **CVE-2026-93687** ([GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)). Depo notu, Metro dosya eşleme/build zincirinde kullanıldığını belirtiyor.

İstisnalar `pnpm-workspace.yaml:67-75` içinde gerekçelendirilmiş; Expo SDK yükseltmelerinde yeniden kontrol edilmeleri gerektiği de not edilmiş.

### Düşük — kullanılmayan export ve ölü kod adayları

Knip **123 değer export’u**, **16 tür export’u** kullanılmıyor; ayrıca **5 dosya**, **3 bağımlılık** ve **1 aynı hedefe giden export çifti** aday olarak raporladı. Bu sonuçlar doğrudan silme önerisi değildir: Knip dinamik yükleme, framework giriş noktaları ve yapılandırma içindeki dosya yollarını kaçırabiliyor.

Doğrulanan örnekler:

- [`memoryVaultForTests`](../../apps/mobile/src/features/storage/vault.ts#L85) depo içinde başka yerde kullanılmıyor; işlevin kendisi ölü kod adayı.
- [`ACCESS_TOKEN_TTL_SECONDS`](../../apps/api/src/auth/access-tokens.ts#L14), [`plusLive`](../../apps/api/src/billing/billing.service.ts#L49), [`fullHourAfter`](../../apps/api/src/docs/docs.service.ts#L36) ve [`radialAngles`](../../apps/mobile/src/features/map/person-focus.ts#L46) kendi dosyalarında kullanılıyor; dışa aktarma işareti gereksiz olabilir.
- [`font`](../../apps/mobile/src/theme/typography.ts#L23) aynı dosyada tipografi tanımları tarafından kullanılıyor; dışa aktarımı ve tema barrel’ından yeniden dışa aktarımı kullanılmayan API yüzeyi adayı.
- Knip’in “kullanılmayan dosya” dediği `migrate-cli.ts`, `healthcheck.ts`, `worker.ts`, `build-icons.mjs` ve `build-map-styles.mjs` sırasıyla paket/Docker giriş noktalarında veya elle çalıştırılan üretim scriptlerinde kullanılıyor; ölü dosya olarak doğrulanmadı.
- Google font paketleri `app.config.ts` içindeki font dosya yollarıyla; `@protomaps/basemaps` ise `scripts/build-map-styles.mjs` ile kullanılıyor. Knip bu dolaylı kullanımları yakalamadı.
- `photoSchema` / `photoUploadSchema` aynı schema nesnesini adlandırıyor; biri mobil istemcide, diğeri API yüklemesinde kullanılıyor.
- `@nestjs/schematics` Knip tarafından manifestsiz bağımlılık olarak işaretlendi; `nest generate --help` komutu mevcut Nest CLI koleksiyonunu başarıyla çözdü. `expo-updates` uyarısı kaynakta doğrudan kullanımla doğrulanmadı.

### Gizli bilgi taraması

Depodaki izlenen metin dosyalarında API anahtarı, JWT ve PEM benzeri değer desenleri tarandı. Eşleşmeler yalnızca testlerde kullanılan sahte token/credential örnekleriydi; uygulama veya dağıtım yapılandırmasında gerçek bir gizli bilgi bulgusu çıkmadı. Gitleaks çalıştırılabilir dosyası bu ortamda kurulu olmadığından bu sonuç regex tabanlı çalışma ağacı taramasıdır; Git geçmişi taranmadı.

## Kontrol sonuçları

### Başarılı

- ESLint: `apps/`, `packages/`, kök `.mjs` dosyaları ve `scripts/`; hata veya uyarı yok. ESLint yapılandırmasındaki `eslint-plugin-security` kuralları da bu taramaya dahildi.
- TypeScript: API, mobil, crypto ve schemas çalışma alanlarında hata yok.
- Prettier: `prettier --check .` başarılı.
- Görünmez karakter taraması: `scripts/check-invisible-chars.mjs` başarılı.
- Build: API Nest/SWC build’i 125 dosyada başarılı; crypto ve schemas TypeScript build’leri başarılı.
- Testler:
  - API birim: **93 test / 10 dosya geçti**.
  - API entegrasyon: **230 test / 30 dosya geçti**. Ayrı test PostgreSQL/Redis konteynerleri kullanıldı.
  - Schemas: **93 test / 9 dosya geçti**.
  - Crypto: **171 test / 18 dosya**, performans testi **1 test / 1 dosya geçti**; kapsam %100.
  - Mobil: **489 test / 77 dosya geçti**.

### Ortam sınırlamaları

- Yerel Node sürümü **v25.5.0**. Depo `.nvmrc` ve `devEngines` ile **24.21.0** sabitliyor; `engines` aralığı da Node 25’i kapsamıyor. Kontroller mevcut sürümde geçti, fakat sonuçlar desteklenen Node sürümünde yeniden doğrulanmalı.
- Üst düzey `pnpm build`, Turbo API build görevini başlatırken Windows’taki `pnpm.cmd` sarmalayıcısının bulunmayan bir çalıştırılabilir yolu çağırması nedeniyle tamamlanmadı. Aynı API build’i doğrudan Nest CLI ile, crypto/schemas build’leri doğrudan TypeScript ile başarılı oldu.
- Bu rapor statik analiz ve test sonuçlarını içerir; mobil native iOS/Android derlemesi, penetrasyon testi ve Git geçmişi secret taraması yapılmadı.

## Çalışma ağacı notu

Tarama sırasında kaynak kod değiştirilmedi. `BARGU_PLAN.md` tarama başlamadan önce zaten değiştirilmiş durumdaydı; bu değişiklik korunmuştur. Bu rapor, istenen yeni Markdown çıktısıdır.
