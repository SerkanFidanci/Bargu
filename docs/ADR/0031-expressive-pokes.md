# 0031. İfadeli dürtmeler: öp, sarıl, kız, gül, heyecan; "nerdesin?", "ne zaman?", "cevap ver"

- Durum: Kabul edildi (proje sahibinin isteği, 2026-10-23; PM'e bildirildi)
- Tarih: 2026-10-23
- İlgili: [ADR 0016](0016-sealed-push-notifications.md) (mühürlü bildirim),
  [ADR 0027](0027-calm-mode-and-motion-budget.md) (efekt bütçesi, sakin mod),
  [PROTOCOL §6 ve §9](../PROTOCOL.md), BARGU_PLAN §4.3 (dürtme).

## Bağlam

Bugünkü dürtme (`bump`) tek tür: alan telefonda kişinin pini bir kez zıplar, bir satır çıkar.
Sahip ("dürtmeleri geliştir, çeşitli tarzlar gelsin"): öpme, sarılma, sinirlenme, gülme,
heyecanlanma, "nerdesin?", "ne zaman?", "cevap ver". Dürtülen kişinin ekranında bir şey olsun:
"öpmede dürtülenin ekranı öpülsün, animasyonlu".

## Karar

### 1. Yeni şifreli mesaj türü `poke`

`{ kind: 'poke', to, style, say?, ts }` (PROTOCOL §6), `bump` gibi gönderenin sender key'iyle
şifrelenir, imzalanır, 512 bayta dolgulanır ve aynı yoldan (`/v1/bumps`, canlı soket `bump`) iletilir.
Sunucu tutmaz, türünü görmez. Dakikada 10 sınırı aynı kalır.

- `to`: dürtülen kişi. Mesaj çemberin herkesine gider, ama yalnızca `to` olan telefon gösterir;
  öbürleri atar. Mühürlü bildirim de yalnız onun cihazına gider. Yani grupta "Ayşe Bora'yı öptü"
  kimseye görünmez.
- `style`:
  - duygular: `kiss`, `hug`, `angry`, `laugh`, `excited`;
  - sorular: `where` ("Nerdesin?"), `when` ("Ne zaman?"), `answer` ("Cevap ver!");
  - `reply`: bir soruya hızlı cevap.
- `say`: yalnız `reply` ile, hazır cevaplardan biri: `onWay` (Yoldayım), `soon` (Az kaldı),
  `home` (Evdeyim), `busy` (Şu an müsait değilim), `later` (Sonra yazarım), `ok` (Tamam).
  - Serbest metin yok. Yazışma mesajlaşmanın işi (ADR 0032).
  - Böylece dürtme kötüye kullanıma ve içerik denetimine açılmaz.

Eski `bump` (düz dürtme) olduğu gibi kalır; "Dürt 👉" yine onu gönderir. Eski uygulamalar `poke`'u
bilmez, sessizce atar. Seviye artırmak gerekmez: kayıp yalnız bir dürtme.

### 2. Alan telefonda: ekranı kaplayan kısa animasyon

Uygulama açıksa hangi ekranda olursa olsun bir katman oynar (en çok ~1,6 sn, dokunuşları kesmez):

| Tür     | Ne olur                                              |
| ------- | ---------------------------------------------------- |
| öp      | büyük 💋 ortada atar; küçük öpücükler ekrana dağılır |
| sarıl   | 🤗 büyür, ekranın kenarları sıcak bir ışıkla sarar   |
| kız     | büyük 😠 sarsılır, ekranın kenarları kızarır         |
| gül     | 😂'ler alttan zıplayarak yükselir                    |
| heyecan | konfeti ve 🤩                                        |

- Sorular (`where`, `when`, `answer`) üstten bir kart açar: sorunun simgesi, kimin sorduğu ve hazır
  cevaplar. Bir dokunuşla `reply` gider; kart 12 sn sonra kendiliğinden kapanır.
- Cevap (`reply`) kısa bir kart olarak görünür.
- Animasyonlar Reanimated worklet, motion tokenları; sabit süre yok.
- ADR 0027'ye uyar:
  - efekt "Kapalı" ya da pil tasarrufu: animasyon yok, yalnız satır ya da kart;
  - "Az": kısa sürüm.
- Bir dokunsal titreşim çalar.

Uygulama kapalıysa mühürlü bildirim gelir; metni alan telefon yazar:

- duygular: "Ayşe seni öptü 💋";
- sorular: "Ayşe: Nerdesin?";
- cevaplar: "Ayşe: Yoldayım".

Bildirime dokununca uygulama açılır ve animasyon bir kez oynar; dürtme ne kadar beklemiş olursa olsun.

Aynı dürtme hem soketten hem bildirimden gelirse bir kez oynar (gönderen ve zaman damgasıyla
ayırt edilir). Uygulama açıkken kendiliğinden gelen dürtme ise en çok 1 dakikalıksa oynar.

### 3. Gönderen tarafı

Kişi kartındaki "Dürt" bir alt pencere açar. İçinde dokuz kutu var: Dürt 👉 ve sekiz tür.

- Bir dokunuşla gider, "💋 Öpücük gitti · Ayşe" der.
- Sessize alma aynen geçerli: kişinin dürtmelerini kapatan, hiçbir türünü görmez (`bump` ayarı).

## Sonuçlar

- Sunucu değişmez. Protokole bir tür eklenir; PROTOCOL §6 ve §9 güncellenir.
- Ses yok: bildirim kanalının sesi yeter. Ses dosyaları ve çalma sonraya.
- Dürtmeler kaydedilmez, geçmişi yok.
