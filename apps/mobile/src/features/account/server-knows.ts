/**
 * "Sunucu ne biliyor?" (N2, QA-42): what Bargu's server sees to work, in groups, each resting on
 * rows of the accepted leaks in docs/THREAT_MODEL.md ("Kabul edilen sızıntılar"; a test holds the
 * two together), and what it cannot see because the phone encrypts it first. The full list is the
 * privacy policy.
 */
export const SERVER_SEES = {
  account: ['E-posta adresi', 'Kullanıcı adının varlığı', 'Görünen ad ve avatar (sunucuda)'],
  circles: ['Çember üyelikleri', 'Çember adları', 'Çember rolleri'],
  messages: ['Mesaj ve hikaye üst verisi'],
  events: ['Güvendeyim olayları', 'Varış / ayrılış olayları', '"Geç kalacak" olayları'],
  votes: ['Etkinlik belgeleri (sunucuda)', 'Çember içi buluşma'],
  sharing: ['Gönderim zamanları ve sıklığı', 'Konumu geri çekme'],
  guardian: ['Ebeveyn bağlantısı', 'Ebeveyn araçları'],
  push: ['Bildirim zamanlaması (APNs/FCM)', 'Gönderim zamanları ve sıklığı'],
} as const satisfies Record<string, readonly string[]>;

export type ServerSees = keyof typeof SERVER_SEES;
export const SERVER_SEES_KEYS = Object.keys(SERVER_SEES) as ServerSees[];

export const SERVER_CANNOT_SEE = ['location', 'meeting', 'content', 'places', 'history'] as const;
