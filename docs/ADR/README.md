# Mimari Karar Kayıtları (ADR)

Mimariyi değiştiren her karar bir ADR olarak yazılır (CLAUDE.md). Aşağıdaki şablonu
`NNNN-kisa-baslik.md` olarak kopyala. Kabul edilmiş bir ADR yeniden yazılmaz; yerine yenisi yazılır
ve eskisi "yerini aldı" olarak işaretlenir.

| #                                   | Başlık                                                           | Durum        |
| ----------------------------------- | ---------------------------------------------------------------- | ------------ |
| [0001](0001-toolchain-baseline.md)  | Araç zinciri (Node, pnpm, TypeScript, ESLint, Expo)              | Kabul edildi |
| [0002](0002-backend-foundations.md) | Backend temeli (NestJS 12 ESM + Fastify, pg, node-redis)         | Kabul edildi |
| [0003](0003-staging-deployment.md)  | Staging dağıtımı (paylaşımlı VPS, host nginx, GHCR, kısıtlı SSH) | Kabul edildi |
| [0004](0004-e2ee-protocol.md)       | Uçtan uca şifreleme protokolü v1                                 | Kabul edildi |

## Şablon

```md
# NNNN. Başlık

- Durum: Önerildi | Kabul edildi | Yerini aldı: NNNN
- Tarih: YYYY-AA-GG

## Bağlam

## Karar

## Sonuçlar
```
