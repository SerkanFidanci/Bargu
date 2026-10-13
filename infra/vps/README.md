# Staging sunucu rehberi

Staging, **başka bir projeyi de barındıran mevcut bir sunucuda** çalışır. Temel kural: Bargu
değişiklikleri sadece ekleme yapar ve kendi klasörlerinde kalır; diğer projeye ait hiçbir şey
değiştirilmez.

- **Giriş kapısı (ingress)**: sunucudaki nginx (diğer proje için 80/443'ü zaten kullanıyor) bir site
  daha alır: `bargu-staging`. Sertifikası sunucudaki certbot ile Let's Encrypt'ten alınır.
- **Stack**: `infra/staging/compose.yml` (compose projesi `bargu-staging`) — API sadece
  `127.0.0.1:3100`'de açık; Postgres ve Redis dışarıya kapalı iç ağda.
- **Deploy**: GitHub Actions API imajını build eder, GHCR'a gönderir ve SSH ile sunucuya yükler
  (sadece deploy komutunu çalıştırabilen anahtar, sağlık kontrolü, hata olursa otomatik geri dönüş).
- **Domain**: gerçek domain alınana kadar `api.<IP-tireli>.sslip.io` (ücretsiz, hesap gerektirmeyen,
  içindeki IP'ye çözülen DNS). Passkey ve universal link için gerçek domain gerekecek (Faz 2).

Karar kaydı: [ADR 0003](../../docs/ADR/0003-staging-deployment.md).

## Sunucu güvenlik ayarları (2026-10-13'te uygulandı)

- SSH: sadece anahtarla giriş (`/etc/ssh/sshd_config.d/00-hardening.conf`: şifre kapalı, root
  sadece anahtarla).
- fail2ban: `sshd` koruması (`/etc/fail2ban/jail.local`; Ubuntu 24.04'te log birimi `ssh.service`
  olduğu için eşleşme düzeltildi).
- Zaten vardı: ufw (22/80/443), otomatik güvenlik güncellemeleri, nginx + certbot.

## 1. Stack'i kur (sadece ekleme yapar)

```bash
ssh-keygen -t ed25519 -N "" -C github-actions-deploy -f bargu-deploy   # sadece CI'ın kullanacağı anahtar
scp -r infra bargu-server:/tmp/bargu-infra
ssh bargu-server 'sh /tmp/bargu-infra/vps/setup-staging.sh "$(cat)"' < bargu-deploy.pub
```

[`setup-staging.sh`](setup-staging.sh) sadece şunları oluşturur: `deploy` kullanıcısı (anahtarı tek
bir komutla sınırlı), `/usr/local/bin/bargu-deploy` (root'a ait) ve şifreleri sunucuda üretilen
`/opt/bargu/staging`. Tekrar çalıştırmak güvenlidir, `.env`'in üzerine asla yazmaz.

## 2. nginx üzerinden yayına al

```bash
ssh bargu-server 'sh /tmp/bargu-infra/vps/setup-nginx.sh api.<IP-tireli>.sslip.io 3100'
```

[`setup-nginx.sh`](setup-nginx.sh) `/etc/nginx/sites-available/bargu-staging` dosyasını yazar,
sertifikayı alır (`certbot certonly --nginx`; yenilemeden sonra nginx otomatik yeniden yüklenir) ve
her kesintisiz yeniden yüklemeden önce `nginx -t` ile doğrular; geçersiz ayar geri alınır.

## 3. GitHub'ı bağla

Repository → Settings → Environments → **staging** (deploy dalı: `main`; onaylayıcı eklemek
önerilir):

| Tür      | Ad                        | Değer                                              |
| -------- | ------------------------- | -------------------------------------------------- |
| Secret   | `STAGING_SSH_KEY`         | `bargu-deploy` özel anahtarı                       |
| Variable | `STAGING_SSH_HOST`        | sunucu IP'si                                       |
| Variable | `STAGING_SSH_KNOWN_HOSTS` | `ssh-keyscan -t ed25519 <sunucu-ip>` (doğrulanmış) |
| Variable | `STAGING_API_DOMAIN`      | 2. adımdaki domain                                 |

Ardından repo değişkeni `STAGING_ENABLED` = `true` yap ve yerel özel anahtar dosyasını sil. Host
anahtarını kaydetmeden önce parmak izini sunucuda `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`
ile karşılaştır.

## 4. Deploy

`main`'e gelen her yeşil CI otomatik deploy eder; Actions → **Deploy staging** → _Run workflow_ ile
elle de tetiklenebilir. Deploy script'i imajın tam digest'ini çeker, sağlık kontrollerini bekler,
yeni sürüm sağlıklı olmazsa önceki digest'e geri döner.

Kontrol: `curl https://<domain>/health/live` → `{"status":"ok"}`.

## Günlük işler

```bash
ssh bargu-server
cd /opt/bargu/staging
docker compose --env-file .env --env-file image.env ps
docker compose --env-file .env --env-file image.env logs -f api
curl -s http://127.0.0.1:3100/health/ready   # hazır olma kontrolü sadece sunucunun içinden erişilir
```

- Postgres ve Redis dışarıya port açmaz, iç ağdadır.
- Yedekleme: henüz kurulu değil (Faz 0'da kullanıcı verisi yok). Gerçek kullanıcı verisinden önce
  şifreli yedek ve geri yükleme testi şart (Faz 10).
