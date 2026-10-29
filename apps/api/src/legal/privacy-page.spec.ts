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
    ]) {
      expect(PRIVACY_PAGE_HTML).toContain(words);
    }
  });

  it('has nothing left for the owner to fill in, and loads nothing from elsewhere', () => {
    expect(PRIVACY_PAGE_HTML).not.toMatch(/\[[^\]]*\]/);
    expect(PRIVACY_PAGE_HTML).not.toMatch(/<script|src="http/);
    expect(PRIVACY_PAGE_CSP).toContain("default-src 'none'");
  });
});
