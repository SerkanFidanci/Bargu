# 0012. Dört haneli giriş kodu

- Durum: Kabul edildi
- Tarih: 2026-10-14
- Önceki karar: ADR 0005'teki 8 haneli kodun yerine geçer (diğer kuralları geçerli).

## Bağlam

Proje sahibi giriş kodunun 4 haneli olmasını ve ekranın bir tasarım örneğine göre yeniden
yapılmasını istedi (dört kutu; son hane girilince kutular bir yörüngeye kıvrılıp tek bir
"doğrulandı" kutusuna iner; renk yalnızca sonuçta). 8 hanede tahmin olasılığı 10⁸'de 1 iken
4 hanede 10⁴'te 1; deneme sınırları aynı kalsaydı bir saldırgan bir adres için günde 50 tahminle
yaklaşık 200 günde kodu bulurdu.

## Karar

- **Kod 4 hane** (`packages/crypto` `OTP_DIGITS = 4`; türetme aynı: HMAC'in ilk 48 biti mod 10⁴).
- **Deneme bütçeleri sıkılaştırıldı** (apps/api `otp.service.ts`):
  - kod başına 3 yanlış (önce 5), sonra kod ölür;
  - (adres, cihaz) başına saatte 5 yanlış (önce 10), yalnızca o cihaz kilitlenir;
  - adres başına günde 10 yanlış (önce 50) ve **haftada 20** (yeni), sonra adres herkese kilitlenir.
    Haklar, kod karşılaştırılmadan önce tek adımda ayrılır (eşzamanlı tahminle aşılamaz).
- Olasılık: bir adresi hedef alan sabırlı bir saldırgan için günde %0,1, yılda en çok yaklaşık
  %10 (haftada 20 tahmin × 52 hafta ≈ 1040 tahmin / 10⁴).
- Diğer korumalar aynen sürer: kod yalnızca onu isteyen cihazın anahtarıyla kullanılabilir; her
  kod isteği hesabın sahibine e-posta olarak gider (fark edilir); istemci ağı sınırları; yayında
  App Attest / Play Integrity zorunlu; birincil giriş yolu passkey.
- **Ele geçirilse bile**: yeni cihazla girişte arkadaşların telefonları "anahtar değişti" uyarısı
  gösterir ve kullanıcı onaylamadan o cihaza anahtar göndermez (ADR 0009). Saldırgan hesabı alsa
  da arkadaşların konumunu göremez; eski cihaz anında çıkış yapar.

## Sonuçlar

- Daha hızlı ve rahat giriş; güvenlik payı 8 haneye göre belirgin biçimde düşük. Yıllık ~%10
  tahmin riski kabul edildi; gerekirse 6 haneye (aynı bütçelerle yılda ~%0,1) geçmek tek sabit
  değişikliğidir.
- Meşru kullanıcı günde 10'dan fazla yanlış yazarsa ertesi güne kadar e-posta koduyla giremez
  (passkey ile girebilir).
- Eski (8 hane bekleyen) uygulama sürümleri yeni koda giremez; önizleme sürümleri güncellenir.
