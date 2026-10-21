# Bargu

Arkadaşlar ve aile ile canlı konum paylaşımı — **Zenly hissi, Signal güvenliği.** Konumlar uçtan
uca şifrelenir; sunucu hiçbir zaman düz koordinat görmez.

- Plan ve fazlar: [BARGU_PLAN.md](BARGU_PLAN.md) · Geliştirme kuralları: [CLAUDE.md](CLAUDE.md)
- Proje durumu ve açık işler: [docs/DURUM.md](docs/DURUM.md)
- Protokol: [docs/PROTOCOL.md](docs/PROTOCOL.md) · Tehdit modeli: [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md)
- Mimari kararlar: [docs/ADR](docs/ADR/README.md) · Staging sunucusu: [infra/vps/README.md](infra/vps/README.md)

## Klasör yapısı

```
apps/
  api/        NestJS 12 (Fastify, ESM) — Postgres (pg), Redis (node-redis)
  mobile/     Expo SDK 57, Expo Router, dev client
packages/
  crypto/     E2EE protokolü (saf TS, %100 test kapsamı) + swift/ (iOS CryptoKit tarafı)
  schemas/    Ortak zod şemaları (şifreli içerik, kablo biçimleri)
  config/     Ortak ESLint, TypeScript ve Prettier ayarları
infra/
  docker-compose.yml   Lokal Postgres, Redis, Mailpit
  staging/             Staging stack'i (API, Postgres, Redis), nginx site dosyası, deploy script'i
  vps/                 Staging sunucu rehberi ve kurulum script'leri
docs/ADR/              Mimari karar kayıtları
```

## Gerekenler

- **pnpm 12**: `npm install --global pnpm@12.11.2`. Node'u ayrıca kurmana gerek yok: pnpm, projenin
  istediği Node 24.21.0'ı (`devEngines.runtime`) kendisi indirip her komutta kullanır.
- **Docker Desktop**: lokal Postgres / Redis / Mailpit için.
- **gitleaks**: commit öncesi gizli bilgi (şifre, anahtar) taraması için.
  Windows: `winget install --id Gitleaks.Gitleaks` · macOS/Linux: `brew install gitleaks`

## İlk çalıştırma

```bash
pnpm install
cp infra/.env.example infra/.env
cp apps/api/.env.example apps/api/.env
pnpm infra:up      # Postgres + Redis + Mailpit; hepsi sağlıklı olana kadar bekler
pnpm dev           # API :3000'de, Metro (mobil) :8081'de
```

- API: `http://localhost:3000/health/live`, `http://localhost:3000/health/ready`
- Mailpit (test e-postaları): `http://localhost:8025` (port `infra/.env` içinden değiştirilebilir)
- Telefona kurulum: [apps/mobile/README.md](apps/mobile/README.md)

## Komutlar

| Komut                                                       | Ne yapar                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------- |
| `pnpm dev`                                                  | API (değişiklikte yeniden başlar) ve Metro, Turborepo ile     |
| `pnpm dev:api` / `pnpm dev:mobile`                          | Tek uygulama; `dev:mobile` Expo'nun klavye kısayollarını açar |
| `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` | Tüm projede tip kontrolü, lint, test, build (önbellekli)      |
| `pnpm format` / `pnpm format:check`                         | Prettier ile biçimlendirme                                    |
| `pnpm infra:up` / `infra:down` / `infra:logs`               | Lokal bağımlılıkları aç / kapat / logları izle                |

## Yerel script'ler ve ağır test kilidi

Bu makinede birden çok ajan aynı anda çalışır. Ağır test koşuları (Linux CI kopyası, tam mobil Jest)
üst üste binince mobil ekran testleri 18 sn yerine 37-80 sn sürüp zaman aşımına uğrar ve iyi bir
commit kırmızı görünür. Bu yüzden ağır koşular **tek bir makine geneli kilit** altında sırayla
çalışır.

| Komut                                        | Ne yapar                                                                                                        |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `bash scripts/ci-linux.sh [commit]`          | CI'ın format, typecheck, lint, test ve build işini temiz bir kopyada Docker'da (Ubuntu) çalıştırır; kilidi alır |
| `bash scripts/with-test-lock.sh <komut...>`  | Verilen komutu kilit altında çalıştırır; kilit doluysa sırasını bekler                                          |
| `pnpm test:mobile:locked [jest argümanları]` | Tüm mobil Jest'i kilit altında çalıştırır; ör. `pnpm test:mobile:locked src/features/auth`                      |
| `pnpm test:lock`                             | Kilidin kendi testi (yaklaşık 30 sn): paralel koşu, eski kilit devralma, hata ve sinyalde bırakma               |

- **Kilit**: `<geçici klasör>/bargu-test.lock` klasörü. Repo dışındadır, bu yüzden tüm worktree'ler
  aynı kilidi görür. Windows'ta `%TEMP%` kullanılır (Git Bash'te `/tmp/bargu-test.lock`; Git Bash
  penceresinden de PowerShell'den başlatılan bash'ten de aynı klasör). `mkdir` atomik olduğu için
  kilidi tek koşu alır; klasörün içinde sahibin `pid`, `started`, `since` ve `command` dosyaları
  durur. Yolu görmek için: `bash scripts/with-test-lock.sh --print-lock-path`.
- **Beklerken** ilk anda ve sonra dakikada bir şu satır yazılır (stderr):
  `bekliyor: başka bir test koşusu çalışıyor (pid 1234, 2026-10-21 14:03:11)`. Kilit alınınca
  `kilit alındı (N sn bekledi)` yazılır.
- **Eski kilit**: sahibinin pid'i artık yoksa ya da kilit 2 saatten eskiyse `kilit devralındı: ...`
  mesajıyla devralınır; elle silmek gerekmez. Komut bitince, hata verince, Ctrl-C ya da SIGTERM
  alınca kilit bırakılır. Kilitli bir komutun içinden kilidi tekrar istemek takılmaz (doğrudan
  çalışır).
- **Başka ağır koşu** (kendi Docker ya da Jest script'in) başlatacaksan onu da
  `bash scripts/with-test-lock.sh ...` ile sar. Hafif koşular (tek test dosyası, `pnpm lint`) kilit
  istemez.
- **Windows**: Git Bash'ten çalıştır. PowerShell'de `bash` WSL'e gider ve çalışmaz; PowerShell'den:
  `& 'C:\Program Files\Git\bin\bash.exe' scripts/with-test-lock.sh pnpm --filter @bargu/mobile test`.
- **Mobil Jest zaman aşımı**: test başına 15 sn (`apps/mobile/package.json` içinde
  `jest.testTimeout`). Süre ölçen testler kendi `jest.setTimeout` değerini kullanır, etkilenmez.

## Kalite ve güvenlik kapıları

- **Commit öncesi**: gitleaks gizli bilgi taraması, ardından değişen dosyalarda ESLint + Prettier.
- **CI** (`.github/workflows/ci.yml`): kilitli lockfile ile kurulum, format, tip kontrolü, lint,
  test, build ve `pnpm audit --audit-level high`.
- **Güvenlik** (`security.yml`): gitleaks (tüm geçmiş), Semgrep, CodeQL (TypeScript + Actions);
  ayrıca haftada bir.
- **Bağımlılıklar**: Renovate (Actions ve imajlar digest ile sabit, yeni sürümler 7 gün bekletilir);
  pnpm 24 saatten yeni ve yayın kanıtı zayıflamış sürümleri kurmaz, install script'leri sadece izin
  listesindeki paketlerde çalışır.
- **Staging deploy** (`deploy-staging.yml`): CI yeşilse imaj GHCR'a gönderilir ve sunucuya sadece
  deploy komutunu çalıştırabilen bir SSH anahtarıyla yüklenir; sağlık kontrolü geçmezse önceki
  sürüme otomatik döner.
