import { describe, expect, it } from 'vitest';

import { PRIVACY_PAGE_CSP, PRIVACY_PAGE_HTML } from './privacy-page.js';

describe('the privacy page (/gizlilik, docs/play-store/GIZLILIK-POLITIKASI.md)', () => {
  it('says the text of 29.10.2026 in both languages, with messages, photos and reports', () => {
    expect(PRIVACY_PAGE_HTML).toContain('Son güncelleme: 29.10.2026');
    expect(PRIVACY_PAGE_HTML).toContain('Last updated: 29.10.2026');
    expect(PRIVACY_PAGE_HTML).toContain('<article lang="en" id="en">');
    for (const words of [
      'Mesajlar, anlık fotoğraflar ve hikayeler',
      'Bildirdiğin içerik',
      'Engelleme listen',
      'Messages, instant photos and stories',
      'Content you report',
      'support@otenus.com',
      // Who opened a story goes to its sender alone (ADR 0035 Ek 1, the PM 29.10.2026).
      'Bir hikayeyi açtığında adın ve açtığın saat',
      'When you open a story, your name and the time go',
      // "Sorun bildir" goes from the user's own email app (the PM, 29.10.2026).
      'Destek yazışmaların (isteğe bağlı)',
      'Your support messages (optional)',
      // Package B (the PM, 29.10.2026): per-person sharing and "Yakındayım", no new data.
      'Kime, ne kadar süre göstereceğin (kişiye özel paylaşım) yalnızca telefonunda',
      'Who sees you and for how long (per-person sharing) stays only on your phone',
      '"Yakındayım" daveti de bir mesajdır',
      `An "I'm nearby" invite is a message too`,
      // Ö7 (the PM, 30.10.2026): one's own history, only on the phone, asked before it goes.
      'Kendi konum geçmişin (isteğe bağlı, kapalı başlar, Bargu+)',
      'Kapatırken sorulur ve onaylayınca telefondan hemen silinir',
      'Your own location history (optional, off by default, Bargu+)',
      'When you turn it off you are asked first',
      'yalnızca telefonunda, seçtiğin kadar: 30 gün ya da 1 yıl',
      // The metadata the server sees, as the PM listed it (QA-42).
      'kısa mı uzun mu ve fotoğrafın boyutu',
      'whether short or long and a photo',
      // QA-43, the PM's text of 30.10.2026: who looks at whom, the plan, the age group, consent.
      'haritada kimin kime baktığı',
      'who is looking at whom on the map',
      'kimde Bargu+ ya da deneme olduğu',
      'aydınlatmayı okuduğun ve rıza verip geri çektiğin an',
      'yaş grubu, rıza ve abonelik kayıtları hesabınla birlikte silinir',
      'age group, consent and subscription records are deleted with your account',
      // Package C (the PM, 06509c5): the arrival check and the event roll call.
      'Eve vardım kontrolü (isteğe bağlı)',
      'Bargu acil servis değildir',
      'Arrival check (optional)',
      'Bargu is not an emergency service',
      'Sunucu kimin hangi yoklamaya ne zaman cevap verdiğini görür',
      'The server sees who answered which roll call and when',
      'eve vardım kontrolünün alıcıları ve kurulma, iptal ve uyarı zamanları',
      'kim hangi yoklamaya ne zaman cevap verdi',
      'who gets your arrival checks and when they were set up, cancelled or sent',
      'who answered which roll call and when',
      'eve vardım kontrolü ve etkinlik yoklaması da hizmetin parçasıdır',
      'and so are the arrival check and event roll calls',
      'Etkinlik yoklaması 24 saatte ya da etkinlik bitince silinir',
      'Event roll calls: 24 hours, or when the event ends',
      'ebeveyn bağlantısı kontrollerini göstermez',
      'the parent link does not show your checks',
      'en çok 8 kişilik etkinliklerde',
      'events of at most 8 people',
    ]) {
      expect(PRIVACY_PAGE_HTML).toContain(words);
    }
    // The server cannot tell an I'm-nearby invite from a message: no such event is listed (QA-43).
    expect(PRIVACY_PAGE_HTML).not.toContain('Güvendeyim, Yakındayım ve varış');
    expect(PRIVACY_PAGE_HTML).not.toContain("I'm nearby and arrival events");
  });

  it('has nothing left for the owner to fill in, and loads nothing from elsewhere', () => {
    expect(PRIVACY_PAGE_HTML).not.toMatch(/\[[^\]]*\]/);
    expect(PRIVACY_PAGE_HTML).not.toMatch(/<script|src="http/);
    expect(PRIVACY_PAGE_CSP).toContain("default-src 'none'");
  });
});
