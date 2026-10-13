# 0001. Araç zinciri

- Durum: Kabul edildi
- Tarih: 2026-10-13

## Bağlam

Faz 0 monorepo'yu kuruyor. Sürümler 2026-10-13'te paket kayıtlarından ve resmi dokümanlardan
doğrulandı (CLAUDE.md: ezberden değil). "En yeni" sürümlerin bir kısmı henüz birlikte çalışmıyor.

## Karar

- **Çalışma ortamı: Node 24.21.0 LTS.** `package.json#devEngines.runtime` ile sabit (pnpm indirip
  her komutta kullanır), ayrıca `.nvmrc`. Node 25'in desteği bitti (2026-06) ve Vitest 5 / Expo onu
  desteklemiyor. Node 26, 2026-10-28'de LTS olacak; araçlar destekleyince geçilir.
- **Paket yöneticisi: pnpm 12.11.2** (`packageManager`). Ayarlar `pnpm-workspace.yaml`'da. İzole
  `node_modules` (Expo SDK 54'ten beri destekliyor).
- **Tedarik zinciri:**
  - pnpm: `minimumReleaseAge: 1440` (katı), `trustPolicy: no-downgrade` +
    `trustPolicyIgnoreAfter: 10080`, `blockExoticSubdeps`, `allowBuilds` izin listesi, sabit
    sürümler, CI'da kilitli lockfile.
  - Renovate: yeni sürümleri 7 gün bekletir.
  - Neden: yeni sürümler karantinada bekler; yayın kanıtı (provenance / trusted publishing)
    öncekilerden zayıf olan bir sürüm, 7 günlük olana kadar reddedilir (çalınmış token deseni).
    Install script'leri sadece incelenmiş paketlerde çalışır. pnpm'in yaş sınırı, lockfile'daki tüm
    kayıtlar 7 günü geçince 7 güne çıkarılacak.
- **Monorepo: Turborepo 2.11.** `dev` her terminalde çalışsın diye etkileşimsiz; Expo kısayolları
  için `pnpm dev:mobile`.
- **TypeScript: 6.0.3, 7.0 değil.** typescript-eslint 8.71 `<6.1` destekliyor; NestJS 12 CLI de
  `~6.0`'a sabit. Renovate ≥6.1'i engelliyor. Sıkı mod + `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`.
- **Lint: ESLint 10** flat config, typescript-eslint `strictTypeChecked`, eslint-plugin-security,
  eslint-comments (`require-description`). CLAUDE.md kurallarını zorunlu kılar: `any` yok,
  `@ts-ignore` yok, her `eslint-disable` gerekçeli, kripto import'ları sadece `packages/crypto`'da,
  `Math.random` yok, `console` yok.
- **Mobil lint:** `eslint-plugin-react-hooks` 7 (React Compiler kuralları dahil) +
  `eslint-plugin-expo`, `eslint-config-expo` **olmadan**. Sebebi: `eslint-config-expo` 57'nin
  getirdiği `eslint-plugin-react` / `eslint-plugin-import`, ESLint 10'da kaldırılan API'leri çağırıyor
  (doğrulandı: `react/display-name`'de çöküyor). Expo ESLint 10 desteği verince yeniden değerlendirilir.
- **Testler:** Vitest 5 (API; decorator metadata için unplugin-swc); Jest 29 + `jest-expo` (mobil).
  Her biri kendi platformunun dokümante ettiği kurulum.
- **Mobil:** Expo SDK 57 (RN 0.86, React 19.2, sadece New Architecture, Hermes V1), typed routes ile
  Expo Router, React Compiler, dev client (Expo Go değil). Yamalar 24 saatten eski sürümlere sabit.
- **Hook'lar:** husky 9 + lint-staged 17; commit öncesi gitleaks. Gizli bilgiler geçmişe girmeden
  engellenir.

## Sonuçlar

- Geliştiricilerin pnpm 12 (`npm i -g pnpm@12.11.2`) ve gitleaks kurması gerekir; Node'u pnpm sağlar.
- 24 saatten yeni Expo yamaları olgunlaşana kadar kurulamaz (bilinçli tercih).
- TypeScript 7'ye ve `eslint-config-expo`'ya geçiş, ekosistem kısıtları kalkınca yapılır; Renovate
  kuralları bu sınırları içeriyor.
