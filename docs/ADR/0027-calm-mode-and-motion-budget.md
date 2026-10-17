# 0027. Sade mod ve animasyon bütçesi

- Durum: Kabul edildi (PM, 2026-10-17)
- Tarih: 2026-10-17
- İlgili: [ADR 0008](0008-design-system-and-map.md) (tasarım sistemi, hareket tokenları),
  [ADR 0013](0013-weather-without-location.md) (hava katmanı),
  [ADR 0026 §8](0026-meetings-in-any-circle.md) (harita kısayolları ve buluşma sayacı)

## Bağlam

Proje sahibi kısayolların daha efektli olmasını istedi; PM beş efekti onayladı ve iki koşul
koydu: sürekli dönen yeni animasyon yok (pil) ve "haritada hiçbir şeye dokunulmazken animasyon
karesi üretilmesin". İnceleme bugünkü haritada sonsuz dönen animasyonlar buldu:

- Konumu taze, hareketsiz her kişinin avatarı nefes alıyor; yürüyen, araçtaki, bir yere yerleşmiş
  kişinin hareketi, ayak izleri ve düşük pil nabzı sürekli dönüyor.
- Hava katmanı (güneş, yıldız, yağmur, kar, sis, bulut) tek bir Skia tuvalinde her karede
  çiziliyor: harita açıkken saniyede 60 kare, en büyük pil kalemi.

Sahip haritanın canlı olmasını özellikle istedi ve pil denemesine "iyi" dedi. BARGU_PLAN'daki
"Sade mod" maddesi (efekt, ses ve titreşim yoğunluğu: tam / az / kapalı) bu dilime alındı.

## Karar

### 1. Sade mod: tam / az / kapalı

- Ben sayfasında "Efektler (sade mod)": Tam (varsayılan), Az, Kapalı. Seçim yalnızca bu telefonda
  saklanır, sunucuya gitmez.
- **Tam:** bütün hareketler, kutlamalar ve titreşim. Harita canlı kalır (sahibin isteği).
- **Az:** yalnızca kısa, tek seferlik efektler; tekrar eden hareket yok. Avatar her yeni konumda
  hareketini bir kez oynar; konum kayması kısalır; konfeti yarı yarıya; hava durağan çizilir.
- **Kapalı:** hareket, kutlama ve titreşim yok; ekranlar yerinde belirir, harita kamerası atlar,
  hava katmanı yok.
- Bir efektin ne kadar oynayacağı tek yerden gelir (`theme/effects.ts`): `useEffects()` geçerli
  seviyeyi, `timesAt()` tekrar sayısını verir. Sayılar hareket tokenlarındadır (`shortcutFx`,
  `weatherFx.play`, `ambient`).

### 2. Telefonun söyledikleri seçimi geçer, seçimi değiştirmez

- Sistemin "Hareketi azalt" ayarı açıksa: "kapalı" gibi.
- Pil tasarrufu açıksa ya da pil %20'nin altında ve şarj olmuyorsa: "tam", "az" gibi oynar. Durum
  düzelince kendiliğinden eski hâline döner; kullanıcının seçimi değişmez.
- Harita görünmüyorsa (üstünde tam ekran başka bir sayfa, uygulama arka planda): haritadaki her şey
  "kapalı" gibi; hiçbir animasyon görünmeden çalışmaz.

### 3. Hava katmanı sınırlı oynar

- "Tam"da hava, harita açılınca, hava değişince ve haritaya dokunup kaydırınca yaklaşık 20 saniye
  oynar, sonra son karede donar. Oynarken en çok saniyede 30 adım çizilir.
- Sonsuz `useClock` yok: katmanın tek, sonlu bir saati var (`features/weather/play-clock.ts`);
  bütün parçalar (yağmur, kar, sis, bulut, güneş, yıldız, şimşek) onu okur.
- "Az"da durağan tek kare; "kapalı"da ve "Hareketi azalt"ta katman yok.

### 4. Yeni efektler her modda sonlu

- Harita kısayollarının ve sayaç çipinin efektleri (ADR 0026 §8) "tam"da da sonludur: düğmelerin
  yaylı girişi yalnızca harita oturumda ilk açılınca; hayalet 3 tur süzülür ve durur, kapanınca
  "pof"; radar halkası tek; "Geldim" 3 nabız atar ve durur; çip son dakikalarda 3 kez nefes alır;
  dakika değişince rakam bir kez kayar.
- Yeni efektler `repeatFinite()` ile yazılır; sonsuz tekrar yalnızca "tam"daki eski harita
  canlılığında (avatar döngüleri, ayak izleri) kalır.

### 5. Titreşim

- Hafif titreşim (kısayollar, hayalet, Geldim dahil) "kapalı"da çalmaz.

## Ölçüm

Telefonda profil ölçümü yerine bir test (`features/home/idle-frames.test.tsx`): Reanimated'ın sahte
saatinde animasyonlar oturduktan sonraki 10 saniyede istenen kare (`requestAnimationFrame`)
sayılır. Sonsuz bir animasyon her karede bir kare ister, biten hiçbirini.

- "Az" ve "kapalı": avatarların her etkinliği, düşük pil, ayak izleri; yeni bir konumdan sonra da
  **0 kare**.
- "Tam": yürüyen bir avatar kare ister (harita canlı, sahibin isteği).
- "Tam", harita görünmüyorken: **0 kare**.
- Kısayollar (radar, hayalet, Geldim tetiklenmiş) ve sayaç çipi (son dakikalar, dakika değişimi):
  her seviyede **0 kare**.
- Hava: "tam"da oynarken kare var, 20 saniyeden sonra ve yeniden uyandırıldıktan sonra **0**; "az"
  ve "kapalı"da **0**.

## Sonuçlar

- Boştaki harita "az" ve "kapalı"da, pil tasarrufunda ve düşük pilde ("az" gibi) hiç kare üretmez;
  "tam"da yalnızca avatar döngüleri kalır.
- Hava artık saatlerce saniyede 60 kare çizmez; dokununca yeniden canlanır.
- Haritanın canlılığı "tam"da korunur; kullanıcı isterse azaltır.
- Telefonda gerçek pil ölçümü yapılmadı (cihaz yok); test, kare isteklerini sayar.
