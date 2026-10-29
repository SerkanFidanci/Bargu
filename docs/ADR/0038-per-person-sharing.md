# 0038. Kişiye süreli paylaşım ve tek kişiye sessiz dondurma

- Durum: Kabul edildi (PM, 2026-10-29); önerildi (kodlama oturumu, 2026-10-29); uygulandı (paket B, Ek 1; Ek 2)
- Tarih: 2026-10-29
- İlgili: [ADR 0008](0008-design-system-and-map.md), [ADR 0019](0019-location-history.md),
  BARGU_PLAN §3.3 ve §4 (çember anahtarları), `docs/arastirma/urun-gelistirme-2026-10-29.md` Ö6,
  Faz 9C paket B

## Bağlam

PM'in raporu (Ö6): "Bu kişiye 21:30'a kadar göster" ve "Yalnız bu kişiye dondur". Life360 ve Google'da
var. Bizde çember bazında var, kişi bazında yok.

Bugünkü yapı (kod):

- Konum **çember başına** mühürlenir: çemberin gönderici anahtarıyla (ADR 0010, PROTOCOL). Çemberdeki
  herkes aynı zarfı açar. Bir üyeyi yalnız o zarftan çıkarmanın yolu yoktur.
- Her çemberin paylaşım ayarı var (`sharing`, `precision`, `until`; `sharing.ts`). Süre dolunca ya da
  kapatılınca konum o çemberden **geri çekilir** (haritadan kaybolur).
- "Dondur" bugün küresel hayalet modunun bir seçeneğidir (son konum durur, yenisi gitmez; `toWithdraw`
  dondurulmuşta hiçbir çemberi geri çekmez). Çember başına dondurma yoktur.
- Arkadaşlık **iki kişilik bir çemberdir** (`kind: 'pair'`). Yani bir arkadaş için çember bazı kişi
  bazıdır.

## Seçenekler

1. **Yalnız arkadaşlıklar (iki kişilik çemberler).** Kişi kartında (Daha fazla altında) "Paylaşımı
   yönet": "21:30'a kadar göster", "Bu kişiye dondur", "Hiç gösterme". Ayar o arkadaşlığın çember
   ayarını değiştirir. Ek protokol yok. Çemberdeki (grup) üyeler için kart "Bu kişiyi yalnız çemberin
   ayarı yönetir" der ve çemberin paylaşım ekranına götürür.
2. **Gruptaki üyelere de ikili mühürleme.** Konum, çemberde dışlanan kişi dışındakilere ayrı ayrı
   (kişisel zarfla) gönderilir. Maliyet: üye sayısı kadar zarf (büyük çemberde pil ve sunucu yükü),
   çember anahtarıyla uyumsuz yeni bir gönderim yolu, alıcıda iki kaynaktan birleştirme, test ve
   güvenlik denetimi. Sunucu "kimin kimden dışlandığını" zarf sayılarından çıkarabilir (üst veri).
3. **Çemberi yeniden anahtarlamak.** Dışlanan kişiyi çıkarıp yeni epoch'la geri almak. Karşı taraf
   "çıkarıldı" görür; "sessiz" olmaz. Reddedilir.

## Öneri

**Seçenek 1 (v1).** Sessiz dondurma ve süreli paylaşım arkadaşlar için yapılır; gerekçe: "kişi bazı"
isteğinin ana durumu (anne, eş, arkadaş) zaten iki kişilik çemberdir ve ek protokol gerekmez.
Gruptaki bir kişi için seçenek 2'nin maliyeti faydasından büyük görünüyor; PM kapatmazsa Faz 11'de
yeniden bakılır.

### Ne yapılır (seçenek 1)

- **Çember başına dondurma** (yeni): `circleSharing(...).frozen: true`. Dondurulmuş çemberin konumu
  yenilenmez, **geri çekilmez** (ayarın adı "dondur": son konum durur). Küresel hayaletteki "Dondur"
  ile aynı sonuç, yalnız o çember için. Alıcı tarafında görünür bir fark yok: konum yaşlanır, "Neden eski?" nötr bir sebep söyler (bağlantı
  yok ya da paylaşım durmuş); dondurulduğu ayrıca belli edilmez.
- **Süreli** (var): `until` ile "21:30'a kadar"; süre dolunca konum geri çekilir (arkadaş haritadan
  kaybolur ya da isteğe göre son konumda kalır: bölüm "Soru 2").
- **Kişi kartı**: "Daha fazla → Paylaşım" satırı bir alt pencere açar: Göster (süresiz), "21:30'a
  kadar" (saat seçici), "Dondur", "Hiç gösterme". Mevcut durum satırda yazar ("21:30'a kadar").
- **Hayalet** küresel kalır ve hepsinin üstündedir (kapalı değilse çember ayarları işlemez).
- 15–17: kurallar aynen (ADR 0023): paylaşımı kısmak serbest; açmak ebeveyn kurallarına tabidir.

### Test

Dondurulmuş çemberin yenilenmemesi ama geri çekilmemesi; süre dolunca geri çekilmesi; gruptaki üyede
satırın "çemberin ayarı" demesi; kişi kartı satırının mevcut durumu söylemesi; hayalet açıkken
çember ayarlarının etkisiz olması.

## Sonuçlar ve riskler

- Sunucuda değişiklik yok. Ek veri yok.
- Dondurma "bilmeden" sürebilir: karşı tarafa bilinen bir ipucu verilmez ama kullanıcı unutursa kişi
  eski bir konum görür. Çözüm: dondurmada hatırlatma ("3 saattir donduruldu"), mevcut paylaşım
  hatırlatma kartıyla (`sharing-reminder`) birleştirilir.

## PM kararları (2026-10-29)

1. **Kapsam yalnız arkadaşlıklar** (seçenek 1). Grup üyesinin kartında "Bu kişiyi çemberin ayarı
   yönetir" yazar ve çemberin paylaşım ekranına götürür. Gruptaki tek kişiye özel paylaşım plana
   v2 fikri olarak girer.
2. **Süre dolunca** arkadaş haritadan kaybolur. Kaybolunca iki tarafa da tek satırlık bilgi düşer
   ("Ayşe ile süreli paylaşım bitti"); yeniden açmak tek dokunuştur.

## Sorular (PM, karara bağlandı: yukarıda)

1. **Kapsam**: Seçenek 1 (yalnız arkadaşlıklar) mi, yoksa grup üyeleri için de ikili mühürleme
   (seçenek 2) mi? Öneri: seçenek 1.
2. **Süre dolunca** arkadaş haritadan kaybolsun mu (bugünkü çember davranışı) yoksa son konumda mı
   kalsın? Öneri: kaybolsun (bugünkü davranış, hafıza ve güven: "gösterme" demek göstermemektir).

## Ek 1 — Uygulama (2026-10-29, paket B)

- **Ayar:** çember ayarına isteğe bağlı `frozen` eklendi (yalnız telefonda, şifreli kasada). Dondurulmuş
  çembere yeni konum gitmez, "Neden eski?" mesajı da gitmez; motor onu geri çekmez (`isFrozenFor`).
  Süreli paylaşım dondurulmuşken de vaktinde biter ve konum geri çekilir. Hayalet her şeyin üstünde.
- **Kişi kartı:** Daha fazla → "Paylaşım" satırı o an ne olduğunu yazar ("Süresiz gösteriliyor",
  "21:30 saatine kadar", "Dondurdun", "Gösterilmiyor"). Arkadaşta pencere açılır: Göster, Bir saate
  kadar göster (yarım saatlik adımlarla altı saat), Dondur, Gösterme; seçim anında uygulanır. Grup
  üyesinde satır "Bu kişiyi çemberin ayarı yönetir" der ve çemberin paylaşım ekranını açar.
- **Süre dolunca, gönderen:** uygulama açıksa "Ayşe ile süreli paylaşım bitti. 1 saat daha paylaşmak
  için dokun." satırı (dokunuş bir saat daha paylaşır); kapalıysa saat seçilirken telefonun kendi
  kurduğu bildirim aynı şeyi söyler ve arkadaşlığı açar. Sunucuya bir şey gitmez.
- **Süre dolunca, arkadaş:** konum geri çekilmeden hemen önce arkadaşlığa bir kez `state` mesajı
  gider: `why: none`, `end: 'timed'` (isteğe bağlı alan; eski uygulama atar, düz "neden bitti"
  okur). Alan telefon "Ayşe ile süreli paylaşım bitti" der.
- **Sınır:** sunucu konum geri çekilince nedeni de sildiği için (PROTOCOL "state") yalnız o an bağlı
  olan arkadaş bu satırı görür; çevrim dışı olan, açtığında arkadaşını haritada göremez, satır
  görmez. Yeni sunucu davranışı istemeden çözülemez; v2'de bakılır.
- **Risk:** `frozen` alanı eski bir APK'ya geri dönülürse eski uygulamanın katı okuyucusu paylaşım
  ayarlarını okuyamaz ve varsayılana döner (her çembere tam konum). Yalnız sürüm düşürmede olur;
  QA ve test edenlere eski APK kurmamaları söylenmeli.

## Ek 2 — PM kararları sonrası (2026-10-29)

- **Bitiş iki tarafa da düşer:** Ek 1'deki sınır kalktı. Bitiş mesajı artık konum geri çekildikten
  hemen sonra gider. Geri çekme önceki nedeni siler; sonra gelen bu mesajı sunucu her durum mesajı
  gibi 24 saat tutar. O an çevrim dışı olan arkadaş da bağlanınca duyar (24 saate kadar). Protokol,
  kripto ve sunucu değişmedi: aynı `state` yolu ve aynı `end: 'timed'` alanı, yalnız sıra değişti.
  Sunucu yine yalnız bir durum mesajının geldiğini ve zamanını görür.
- **Okunamayan ayar, tam konum demek değildir (PM kuralı):** paylaşım ayarları artık esnek okunur:
  bilinmeyen alan atılır, gerisi okunur. Bir çemberin seçimi okunamazsa o çembere konum gitmez;
  ayarların hiçbiri okunamazsa hiçbir çembere (sonradan katılınanlar dahil) gitmez ve haritada
  "Paylaşım ayarların okunamadı" kartı çıkar, "Kontrol et" ayarları açar. Ek 1'deki risk bundan
  sonraki sürümler için kapandı; bu APK'dan önceki bir APK'ya dönülürse eski davranış sürer (PM
  kabul etti: Play sürüm düşürmeye izin vermez, test edenlere eski APK kurmamaları söylenir).
