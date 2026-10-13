# 0003. Staging dağıtımı

- Durum: Kabul edildi
- Tarih: 2026-10-13

## Bağlam

BARGU_PLAN §3.5: tek VPS (Hetzner, AB), Docker Compose, otomatik TLS, `main`'den GitHub Actions ile
staging deploy. Repo public. VPS zaten var ve **başka bir projeyi de barındırıyor**; o projenin
sunucudaki nginx'i (certbot ile) 80/443 portlarını kullanıyor. Henüz bir Bargu domain'i yok.

## Karar

- **Paylaşımlı sunucu, sadece ekleme**: Bargu, `/opt/bargu/staging` altındaki `bargu-staging`
  compose projesinde yaşar; ayrıca bir `deploy` kullanıcısı, `/usr/local/bin/bargu-deploy` ve tek bir
  nginx sitesi eklenir (`infra/vps/setup-staging.sh`, `infra/vps/setup-nginx.sh`). Diğer projeye ait
  hiçbir şey değiştirilmez. Sunucu genelindeki sertleştirme (sadece anahtarla SSH, fail2ban) iki
  projeyi de koruduğu için sahibinin onayıyla uygulandı.
- **Giriş kapısı**: sunucudaki nginx, Bargu'nun kendi alan adı için TLS'i sonlandırır (sadece TLS
  1.3, HSTS, erişim logu yok, `/health/ready` gizli, yükseltme sadece WebSocket) ve API'ye
  `127.0.0.1:3100` üzerinden iletir. Sertifikalar sunucunun certbot'undan (Let's Encrypt). Bargu'ya
  ait bir Caddy planından vazgeçildi: mevcut nginx ile 80/443'ü paylaşamaz.
- **Domain**: gerçek domain alınana kadar `api.<IP-tireli>.sslip.io` — ücretsiz, hesapsız, sunucu
  IP'sine çözülür. Passkey / universal link için (Faz 2) gerçek domain şart.
- **Stack**: sadece API port açar (sadece loopback). Postgres ve Redis `internal` ağda.
  Container'lar tüm Linux yetkilerini bırakır, `no-new-privileges` ile çalışır, mümkün olan yerde
  salt okunur dosya sistemi, bellek limitleri, log döndürme, digest'e sabit imajlar. Ingress ağının
  alt ağı sabit; böylece `TRUST_PROXY` tam olarak nginx'in bağlandığı Docker geçidini gösterir.
- **Teslimat**: CI imajı bir kez build eder (`turbo prune` ile), SBOM ve provenance ile GHCR'a
  gönderir, sonra sunucuya SSH ile bağlanır:
  - CI anahtarı bir **zorunlu komuta** (forced command; `/usr/local/bin/bargu-deploy`, root'a ait)
    bağlıdır; bu komut sadece `ghcr.io/<sahip>/bargu-api@sha256:<digest>` kabul eder — CI hiçbir
    zaman kabuk alamaz;
  - sunucu anahtarı sabitlenmiştir (`STAGING_SSH_KNOWN_HOSTS`), üçüncü parti SSH action yok;
  - registry token'ı çalıştırmanın kısa ömürlü `GITHUB_TOKEN`'ıdır; stdin ile geçici bir Docker
    config'e verilir ve iş bitince silinir;
  - `docker compose up --wait` sağlık kontrollerini bekler, başarısız olursa önceki digest'e döner.
- Deploy, CI tüm kontrolleri geçtikten sonra `main`'e push'ta çağrılan reusable workflow'dur
  (`workflow_run` yok); secret'lar `secrets: inherit` ile geçirilir; `STAGING_ENABLED=true`
  olmadıkça çalışmaz.

## Sonuçlar

- Sunucuda uzun ömürlü registry kimliği yok; CI'ın SSH kabuğu yok.
- `deploy` kullanıcısı `docker` grubunda (sunucuda root'a eşdeğer); zorunlu komut, CI anahtarının
  bununla yapabileceklerini sınırlar.
- sslip.io Public Suffix List'te değil; Let's Encrypt'in alan adı başına limiti tüm sslip.io
  kullanıcılarıyla ortak, yenilemeler arada tekrar denenebilir. Gerçek domain'e geçince bu kalkar.
- Faz 0'da staging için yedek yok (kullanıcı verisi yok). Gerçek veriden önce geri yükleme testi
  yapılmış şifreli yedek şart (Faz 10).
