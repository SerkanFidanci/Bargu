# Bargu — Claude Code Kuralları

Arkadaşlar ve aile ile uçtan uca şifreli (E2EE) canlı konum paylaşımı. **Zenly hissi, Signal güvenliği.**

Ana referans: [BARGU_PLAN.md](BARGU_PLAN.md). Fazları sırayla uygula; mimari, tehdit modeli ve faz tanımları oradadır.

Güncel durum, açık riskler ve tarihli takip işleri: [docs/DURUM.md](docs/DURUM.md) — her faz sonunda güncelle.

## Kalıcı çalışma düzeni (sahip, 2026-11-05)

- **PM rolü ana Kimi oturumunda.** Ürün sırası, kapsam, QA kabulü ve sözleşme netleştirmeleri PM'de;
  kod veya güvenlik bulgusu kanıt ve regresyon testi olmadan kapanmış sayılmaz. Yayın, dağıtım ve dış
  sistem etkisi olan işlemlerde sahibin açık onayı ayrıca gerekir.
- Backend, mobil/frontend ve güvenlik için **aynı kalıcı uzman oturumları** kullanılır. Yeni ve bağımsız
  işlerde mevcut oturum yeniden açılmak yerine `resume` edilir; yeni oturum yalnız gerçekten yeni bir
  uzmanlık veya bağımsız inceleme gerekirse açılır.
- Her çalışma başlangıcında `git status`, bu dosya, `BARGU_PLAN.md` ve `docs/DURUM.md` okunur. Güncel
  iş ve kararlar DURUM'dan alınır; tarihli taramalar ancak güncel kodda yeniden doğrulanınca bulgu olur.
- Kod yazan oturumlar yalnız kendi kapsamındaki dosyaları değiştirir; aynı dosyada iki oturum paralel
  çalışmaz. Salt okunur QA oturumları kod değiştirmez. PM, bulguları önceliklendirip kabulü koordine eder.
- Her işin sonunda değişiklikler, test sonuçları ve kalan riskler DURUM'a; kalıcı mimari/sözleşme
  kararları ilgili ADR'ye yazılır. Böylece oturum belleği kaybolsa bile proje kaldığı yerden sürdürülür.

## Kurallar (BARGU_PLAN.md Bölüm 6)

- Sunucuya **ASLA** düz koordinat gitmez. Her konum `packages/crypto` üzerinden şifrelenir.
- Konum, token, email, push token **log'lanmaz**.
- Kripto kodu sadece `packages/crypto`'da. Kendi primitive'ini yazma, noble kullan.
- Her endpoint: zod input doğrulama + yetki kontrolü + "başka kullanıcı erişemez" testi.
- Polling, pull-to-refresh ve "yenile" butonu yasak. Her durum değişikliği WS olayı olarak yayınlanır ve client cache'i olaydan güncellenir.
- `any`, `@ts-ignore`, `eslint-disable` yasak (gerekçeli istisna hariç).
- Animasyonlar Reanimated worklet; JS thread'de animasyon yasak. Motion tokenları dışında sabit değer yok.
- Yeni bağımlılık: önce gerekçe + bakım durumu. Expo paketleri `npx expo install` ile.
- Paket sürümlerini ezberden değil güncel dokümantasyondan doğrula.
- Kod, commit, değişken isimleri İngilizce; UI metinleri i18n (tr, en).
- Mimariyi değiştiren her karar → `docs/ADR/` altına ADR.
- Her faz sonunda dur: değişiklik özeti, test sonuçları, açık riskler → onay bekle.
