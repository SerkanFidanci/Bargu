/**
 * "Sunucu ne biliyor?" (N2, QA-42): what Bargu's server sees to work, in groups, each resting on
 * rows of the accepted leaks in docs/THREAT_MODEL.md ("Kabul edilen sızıntılar"). A test holds the
 * two together both ways (QA-43): every group rests on a row, and every row is on the screen, so a
 * row added to the table fails the test until the screen says it. What it cannot see is what the
 * phone encrypts first. The full list is the privacy policy.
 */
export const SERVER_SEES = {
  account: [
    'E-posta adresi',
    'Kullanıcı adının varlığı',
    'Görünen ad ve avatar (sunucuda)',
    'Üye kimlikleri (UUIDv7)',
  ],
  circles: [
    'Çember üyelikleri',
    'Çember adları',
    'Çember rolleri',
    'Yerler (sunucuda)',
    'Arkadaş QR / davet linki',
    'Davet sayfası istekleri',
    'Davet bağlantısının önizlemesi',
  ],
  messages: ['Mesaj ve hikaye üst verisi'],
  events: [
    'Güvendeyim olayları',
    'Varış / ayrılış olayları',
    '"Geç kalacak" olayları',
    'Olay zamanları (canlı kanal)',
  ],
  votes: ['Etkinlik belgeleri (sunucuda)', 'Çember içi buluşma'],
  sharing: [
    'Gönderim zamanları ve sıklığı',
    'Zarf boyutu',
    'Konumu geri çekme',
    '"Neden eski?" mesajları',
    'Konum geçmişi (sunucuda)',
    'Geçmişle partner takibi',
  ],
  watch: ['"İzle" olayları (canlı mod)', 'Arka plan canlı modu haberi'],
  plan: ['Abonelik ve çember açıklığı', 'Süs geçiş belgesi'],
  age: ['Yaş grubu'],
  consent: ['Aydınlatma ve rıza kayıtları'],
  guardian: ['Ebeveyn bağlantısı', 'Ebeveyn araçları'],
  push: ['Bildirim zamanlaması (APNs/FCM)', 'Gönderim zamanları ve sıklığı'],
  ip: ['IP adresleri'],
} as const satisfies Record<string, readonly string[]>;

export type ServerSees = keyof typeof SERVER_SEES;
export const SERVER_SEES_KEYS = Object.keys(SERVER_SEES) as ServerSees[];

export const SERVER_CANNOT_SEE = ['location', 'meeting', 'content', 'places', 'history'] as const;
