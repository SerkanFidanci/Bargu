# 0002. Backend temeli

- Durum: Kabul edildi
- Tarih: 2026-10-13

## Bağlam

BARGU_PLAN §3.2 NestJS (Fastify), PostgreSQL, Redis, BullMQ ve Socket.io'yu sabitliyor. Faz 0,
sonraki fazların yeniden yazmadan üzerine inşa edebileceği, production'a uygun bir iskelet istiyor.

## Karar

- **ESM olarak NestJS 12.1** (`"type": "module"`, `module: nodenext`): v12 paketleri sadece ESM.
  DI için eski tip decorator'lar + `emitDecoratorMetadata` hâlâ gerekli.
- **Fastify adaptörü**, `createHttpAdapter()` ile kurulur:
  - pino ile log, hassas alanlar maskelenir (yetki başlıkları, token'lar, email, push token,
    koordinatlar). İstek loglarında ham URL değil **route kalıbı** yazılır (path ve query token
    taşıyabilir); istemci IP'si hiç yazılmaz.
  - Sunucunun ürettiği UUID istek kimliği `x-request-id` olarak döner; istemcinin gönderdiği yok sayılır.
  - 64 KiB body limiti, bağlantı / istek zaman aşımları; `trustProxy` sadece açıkça verilen CIDR
    listesine (Fastify 5.12 artık hop sayısı kabul etmiyor).
- **Nest 12.1'in yerleşik korumaları**: `useSecurityHeaders()` (helmet 8 varsayılanları) ve
  `enableCsrfProtection()` (Fetch-Metadata tabanlı; native istemcileri etkilemez). Ek helmet paketi
  yok. CORS kapalı.
- **Yapılandırma**: tek bir zod şeması; geçersiz ayarla uygulama hiç açılmaz. Hata mesajları değişken
  adını söyler ama değeri asla yazmaz. `.env` sadece varsa okunur; gerçek ortam değişkenleri önceliklidir.
- **Postgres sürücüsü: `pg` 8** (bağlantı / sorgu zaman aşımları olan havuz, boşta bağlantı hatası
  yakalanır). Faz 2'de Drizzle bunun üzerine gelir.
- **Redis istemcisi: `node-redis` 6** (`redis` paketi), ioredis değil: Redis yeni projeler için bunu
  öneriyor, BullMQ 6 destekliyor, Socket.io Redis adaptörü uyumlu. Gerçek zamanlı komutlar geç
  ulaşmasın diye offline kuyruk kapalı; yeniden bağlanma sınırlı artan beklemeyle.
- **Sağlık kontrolleri**: `/health/live` (sadece süreç) ve `/health/ready` (Postgres `SELECT 1` +
  Redis `PING`, her biri 1 sn zaman aşımı, değilse 503). API bağımlılıklar kapalıyken de açılır ve
  onlar gelince kendiliğinden toparlanır.
- **Build**: Nest CLI + SWC builder + tip kontrolü (`nest build`); hızlı geliştirme döngüsü.
- **Container**: çok aşamalı; `turbo prune` ile sadece API bağımlılıkları; `pnpm deploy --prod`
  çıktısı `distroless/nodejs24` üzerinde (kabuk yok), root olmayan kullanıcı, salt okunur dosya
  sistemi, digest'e sabit temel imajlar, Node tabanlı `HEALTHCHECK`.

## Sonuçlar

- Endpoint doğrulaması Nest 12'nin yerleşik Standard Schema pipe'ı + zod ile yapılacak
  (class-validator yok).
- Nest'in kendi logları production'da JSON (`ConsoleLogger`), Fastify'ınki pino; ikisini pino'da
  birleştirmek gözlemlenebilirlik fazında (Faz 10) değerlendirilir.
