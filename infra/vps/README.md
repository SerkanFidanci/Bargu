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

## Bekleyen değişiklikleri uygula (`apply-pending.sh`)

Kodlama oturumu paylaşımlı sunucuya dokunamaz; bekleyen sunucu değişikliklerini tek bir script
yapar. **Sunucu sahibi kendi terminalinden çalıştırır**, önce kuru çalıştırma, sonra gerçek:

```bash
ssh bargu-server 'sh -s -- --dry-run' < infra/staging/apply-pending.sh   # sadece listeler, hiçbir şey değiştirmez
ssh bargu-server 'sh -s' < infra/staging/apply-pending.sh                # uygular
```

[`apply-pending.sh`](../staging/apply-pending.sh) her adımı Türkçe yazar, yapılmış olanı
"zaten yapılmış" diye geçer (ikinci çalıştırma hiçbir şeyi değiştirmez). **İlk satırı bir
uyarıdır** (kuru çalıştırmada da, gerçekte de): "Önce bütün telefonlara yeni APK'yı (seviye 4) kur;
bu betik eski sürümleri kapatır." Betik telefonların sürümünü bilemez; APK'lar kurulmadan çalıştırma.
Adımlar:

1. `.env` ve `compose.yml` tarih damgalı yedeklenir (`.env.bak-…`, `compose.yml.bak-…`; sadece bir
   şey değişecekse; `notice-key.sh` kendi yedeğini ayrıca alır).
2. `.env` içinde `MIN_CLIENT_LEVEL=4` yapılır (seviye 4'ten eski uygulama sürümleri güncelleme
   ister).
3. `compose.yml` içinde `BILLING_TEST` satırından sonra üç `WATCH_PUSH*` satırı eklenir (arka plan
   canlı modu); sonra `docker compose config` ile doğrulanır, bozuksa yedekler geri konur.
4. Sunucu haberlerinin imza anahtarı ([`notice-key.sh`](../staging/notice-key.sh), QA-28 B-1,
   [ADR 0016](../../docs/ADR/0016-sealed-push-notifications.md)): `.env` içinde
   `NOTICE_SIGNING_KEY` yoksa sunucuda üretilir (`NOTICE_SIGNING_KID=stg-n1`), `compose.yml` onu iki
   satırla geçirir, açık yarısı `/opt/bargu/staging/notice-public-key.txt` dosyasına yazılır
   (`apps/mobile/eas.json` → `EXPO_PUBLIC_NOTICE_KEYS` için). **Gizli anahtar hiçbir yerde
   gösterilmez**, yalnız `.env`'de durur. Kuru çalıştırmada `notice-key.sh --dry-run` çalışır ve
   hiçbir şey yazılmaz. Anahtar yeni eklendiyse 8. adım api ve worker'ı yeniden başlatır, sunucu
   imzalamaya başlar. `notice-key.sh` betiğin İÇİNDE gömülüdür (tek betik çalıştırılıyor);
   depodan `sh infra/staging/apply-pending.sh --check-notice-key` gömülü kopyanın dosyayla aynı
   olup olmadığını söyler (`notice-key.sh` değişirse kopya yenilenmeli). Onun yazdığı yollar koruma
   fonksiyonundan geçmediği için, betik onu çağırmadan önce o yollardan biri kısayol (symlink) ise
   reddeder.
5. Sahip ve izinler düzeltilir: `deploy:deploy`, `.env` 0600, `compose.yml` 0640.
6. Düşük ayrıntılı dünya haritası indirilir: `/srv/bargu-map/public/tiles/world.pmtiles` (Protomaps
   günlük yapısı, yakınlaştırma 0-6, yaklaşık 45 MB; bugünün yapısı yoksa dünkü; 7 günden yeniyse
   atlanır). Dosya yokken uygulama haritası bugünkü gibi çalışır
   ([ADR 0008](../../docs/ADR/0008-design-system-and-map.md)).
7. nginx: `/map/` altında bulunamayan dosyanın (404) önbelleğe alınması kapatılır. Eskiden
   `add_header Cache-Control "public, max-age=86400" always` her yanıta, 404'e de, bir gün
   önbellek yazıyordu; `world.pmtiles` yokken sorulan telefonlar dosya gelse de bir gün haritayı
   göremezdi. Şimdi tam dosya (200) ve doğrulaması (304) uzun önbellek, geri kalanı (404, 403 ve
   Range istekleri: 206, 416) tek satır `no-store`
   ([`bargu-staging.conf`](../staging/nginx/bargu-staging.conf), nginx `map` durum + Range
   başlığı). Neden Range yanıtları da: nginx başlıkları 206/416 kararından ÖNCE ekler ve geçersiz
   bir aralıkta başlıkları ikinci kez ekler (416 iki `Cache-Control` satırı ve uzun önbellek
   alıyordu); tek satır `no-store` yalnız böyle mümkün. Bedeli: HTTP önbellekleri 206 saklamaz
   (uygulamanın PMTiles kaynağı zaten saklamaz). Kurulu site dosyası
   (`/etc/nginx/sites-available/bargu-staging`) iki küçük metin değişikliğiyle düzenlenir (bu
   düzeltmenin ilk sürümü zaten kuruluysa `map` bloğu yenisiyle değiştirilir), yedeği
   `/opt/bargu/staging/bargu-staging.nginx.bak-…` olur. **Bu nginx başka sitelere de hizmet
   veriyor** (rastamen): önce `nginx -t` bütün yapılandırmayı denetler, bozuksa yedek geri konur ve
   reload yapılmaz; sonra yalnız `systemctl reload nginx` (asla restart). Aynı değişiklik
   `setup-nginx.sh` ile yeni kurulumlara da gelir (şablon güncellendi).
8. `docker compose up -d --wait worker api` (sadece yeni ayarlarla çalışmıyorlarsa; yeni imza
   anahtarı da bunlardan biridir).
9. Son kontrol: api konteynerindeki `MIN_CLIENT_LEVEL`, `WATCH_PUSH*` ve `NOTICE_SIGNING_KID`
   değerleri (başka hiçbir değer ve gizli bilgi yazılmaz), `/health/live`, `world.pmtiles` boyutu,
   açık anahtar satırı (`stg-n1:…`, herkese açık) ve worker/api günlüğünde o satırın görünüp
   görünmediği (sunucu imzalıyor mu), `/map/` altındaki 404 ile 416'nın `Cache-Control` başlığı
   (tek satır `no-store` olmalı).

Güvenlik: script **sadece** `/opt/bargu/staging` ve `/srv/bargu-map` içine yazar, bir tek istisnayla:
kurulu Bargu nginx site dosyası, **tam yol eşleşmesiyle** (ön ek değil; `/etc/nginx` altında başka
hiçbir dosya yazılamaz). Her yazma tek bir koruma fonksiyonundan geçer, dışarıdaki yol Türkçe
hatayla reddedilir; **hedef dosyanın kendisi bir kısayol (symlink) ise de reddedilir** (içinden
yazılsa ya da `chown`/`chmod` edilse dışarıdaki dosya değişirdi). Sunucudaki diğer projeye
(rastamen) dokunmaz. Yeniden başlatma başarısız olursa yedekler geri yüklenir. Eski yedekler
silinmez.

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
