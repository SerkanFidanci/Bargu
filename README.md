# Bargu

Arkadaşlar ve aile ile canlı konum paylaşımı — **Zenly hissi, Signal güvenliği.** Konumlar uçtan
uca şifrelenir; sunucu hiçbir zaman düz koordinat görmez.

- Plan ve fazlar: [BARGU_PLAN.md](BARGU_PLAN.md) · Geliştirme kuralları: [CLAUDE.md](CLAUDE.md)
- Proje durumu ve açık işler: [docs/DURUM.md](docs/DURUM.md)
- Mimari kararlar: [docs/ADR](docs/ADR/README.md) · Staging sunucusu: [infra/vps/README.md](infra/vps/README.md)

## Klasör yapısı

```
apps/
  api/        NestJS 12 (Fastify, ESM) — Postgres (pg), Redis (node-redis)
  mobile/     Expo SDK 57, Expo Router, dev client
packages/
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
