# 0037. "Yakındayım, gelir misin?": tek dokunuşluk davet, koordinatsız

- Durum: Kabul edildi (PM, 2026-10-29); önerildi (kodlama oturumu, 2026-10-29)
- Tarih: 2026-10-29
- İlgili: [ADR 0035](0035-messages-and-moments.md) (şifreli öğeler, bildirimin içeriği taşımaması),
  [ADR 0026](0026-meetings-in-any-circle.md) (buluşma, varış tahmini), [ADR 0023](0023-age-15-plus.md)
  (15–17), `docs/arastirma/urun-gelistirme-2026-10-29.md` Ö8, BARGU_PLAN Faz 9C paket B

## Bağlam

PM'in ürün raporu (Ö8): whoo'nun büyüme motoru tek dokunuşluk "yakındayım, gelir misin?". Bizde
buluşma var ama ağır (yer, saat, çember). Bu onun tek dokunuşluk hâli: yalnız seçilen çembere gider.
Mesafeyi alan telefon hesaplar.

Kurallar: sunucuya düz konum gitmez, bildirim içeriği taşımaz, yeni izin yok, 15–17 kuralları
geçerli, davranışa dayalı yönlendirme yok (sıralama, seri, "en çok yakın olan" yok).

## Karar

### 1. Yeni şifreli öğe: `near`

Sohbetin öğelerinden biri olur (ADR 0035 §5): `near` (`id, ts`), bir çemberin sohbetine, çemberin
gönderici anahtarıyla mühürlenerek gider. İçinde koordinat, yer adı ya da mesafe **yoktur**.

- 24 saat sonra her yerden silinir (diğer öğeler gibi).
- Sohbette küçük bir satır olarak görünür: "Ali yakınında, gelir misin?". Satırın yanında, alıcının
  telefonunda hesaplanan mesafe yazar (yaklaşık, 50 m'ye yuvarlanmış); aşağıda 2.
- Eski uygulama türü tanımaz ve öğeyi bütünüyle atar (çökme olmaz).
- Sunucuda değişiklik yok: içerik şifreli, tür görünmez; dakikada 30, günde 500 öğe sınırına sayılır.

### 2. Mesafeyi alıcı hesaplar, konum ayrıca gitmez

Alıcı telefon, göndericinin o çemberde zaten paylaştığı **son konumu** (iki dakikadan taze) ve kendi
konumunu kullanır; hiçbiri sunucuya ya da bildirime gitmez.

- Gönderici o çemberle yalnız yaklaşık konum paylaşıyorsa mesafe yazılmaz, yalnız "yakınında" der;
  hayalet ya da paylaşım kapalıyken zaten gönderilemez (bölüm 3).
- Mesafe satırı canlıdır: alıcı açıkken gönderici hareket ettikçe değişir; öğe silinince satır da
  gider. Sade modda hareketsizdir (sayı yenilenir, animasyon yok).

### 3. Kim gönderebilir

"Yakındayım" yalnız şu çemberler için sunulur:

- kullanıcı o çemberle konumunu **şu an gerçekten paylaşıyor** (hayalet kapalı, paylaşım açık, süresi
  dolmamış, çember duraklamamış) ve
- çemberde kullanıcıdan başka en az bir etkin üye var ve
- kalıcı çember (etkinlik çemberi değil; etkinlikte tanışılanlar kişisel zarf alır, ADR 0035 Ek 1).

Gerekçe: paylaşmadığın çembere "yakındayım" demek hem sahte hem anlamsız (alıcı yerini göremez).
Arkadaşlık (iki kişilik çember) buna dahildir.

### 4. Sıklık sınırı

Aynı çembere en çok **10 dakikada bir** (telefonda sayılır; ilk tıklamadan sonra düğme "10 dk sonra"
der). Sunucu sınırı ayrıca geçerli. Amaç dürtme gibi bildirim yağmuruna dönmesin.

### 5. Bildirim

Yeni gönderilen bildirim türü `near` (`circleId, ts`). İçeriği yok: alıcı telefon "**Ali:** yakında,
gelir misin?" yazar (çember adı başlık). Kişi sessize alınmışsa ya da çember sessizse (ADR 0035
Ek 2'nin devamı: çember sessize alma) susar. Engelli kişiden gelen atılır.

- Dürtme gibi değil, mesaj gibi: sosyal kanal, sessize alınabilir; "Güvendeyim" gibi asla susmayan
  sınıfta değil.
- iPhone eklentisi (Swift) bu türü iOS yayınına kadar bilmez; bilinmeyen tür atlanır.

### 6. Ekran

- **+ menüsü** (ADR 0008 Ek 2026-10-29 sonrası dört iş): beşinci olarak "Yakındayım".
- Uygun çember yoksa düğme soluk ve nedenini söyler. Bir çember uygunsa onay satırıyla tek
  dokunuşta gider. Birden çoksa çember seçimi açılır, hepsi seçili gelmez (bilinçli seçim).
- Gönderince toast: "Ali ve 2 kişiye haber verildi".
- Alıcıda: sohbet satırı, haritada o kişinin pinine dokununca kartta "yakınında, gelir misin?"
  görünmez (kartı kalabalıklaştırmayalım); bildirime dokunmak sohbeti açar.

### 7. 15–17

Kural: Davranışa dayalı yönlendirme yok, ama kullanıcının kendi başlattığı davet bunun dışındadır.
Yine de 15–17 yaşındaki bir kullanıcı için **aynı çemberde yetişkin olan ve ebeveyn bağlantısı
olmayan biri** varsa düğme gizlenir mi? Bu bir ürün kararıdır:

- **Öneri:** 15–17 için "Yakındayım" yalnız kullanıcının arkadaşlık (iki kişilik) çemberlerinde ve
  ebeveyniyle olan çemberlerde sunulur; büyük çemberlerde sunulmaz. Çünkü bir gencin bir gruba "yakındayım"
  demesi konumunu belirsiz bir kitleye ilan etmek olur.
- PM kararı gerekir.

## Sonuçlar ve riskler

- Konum bilgisi öğede yok. Alıcının zaten gördüğü konumdan ve kendi konumundan mesafe çıkar; yeni
  bir sızıntı yüzeyi yok.
- Ek üst veri: sunucu "A, çembere bir öğe yolladı" bilgisini görür (ADR 0035 sınırı içinde).
- Kötüye kullanım: 10 dk sınırı, sessize alma, Bildir ve Engelle (bir `near` öğesinin bildirimi
  sohbetin diğer öğeleri gibidir).
- Testler: öğe şeması, yalnız paylaşılan çembere gönderme, 10 dk sınırı, mesafenin yalnız taze ve
  tam konumla yazılması, eski uygulama türü atar, bildirim metni sessize alınana kadar.

## PM kararları (2026-10-29)

1. **15–17 ve büyüklük:** düğme herkes için yalnız arkadaşlıklarda (iki kişilik çember) ve en çok
   8 üyeli çemberlerde görünür; büyük gruplarda gizli. Etkinlik çemberlerinde kimse için yok.
2. **Mesafe** 50 m'ye yuvarlanır. Gönderenin o çemberdeki paylaşımı tam değilse (mahalle ya da
   şehir) alıcı sayı görmez, yalnız "yakınlarda" yazar.
3. **Hayalet** (Dondur ya da Gizle) açıkken düğme kapalı.
4. **Hızlı yanıt:** bildirimde ve sohbette iki hazır cevap: "Geliyorum" ve "Şimdi olmaz". Yeni
   tür değil, sıradan yazı mesajı olarak giderler. Kalp tepkisi de durur.

## Açık sorular (PM, karara bağlandı: yukarıda)

1. 15–17 için büyük çemberlerde gizlensin mi (bölüm 7 önerisi)?
2. Mesafe yaklaşık 50 m'ye yuvarlansın mı (öneri) yoksa tam mı?
3. Alıcıya "Geliyorum" hızlı yanıtı eklensin mi? Öneri: hayır, bu paket A'daki tepkiyle (çift
   dokunuş kalp) yetinir; ikinci bir yanıt türü açmayalım.
