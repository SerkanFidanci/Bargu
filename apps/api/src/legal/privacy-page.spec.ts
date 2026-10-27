import { describe, expect, it } from 'vitest';

import { PRIVACY_PAGE_CSP, PRIVACY_PAGE_HTML } from './privacy-page.js';

describe('the privacy page (/gizlilik, docs/play-store/GIZLILIK-POLITIKASI.md)', () => {
  it('says the text of 27.10.2026 in both languages, with messages, photos and reports', () => {
    expect(PRIVACY_PAGE_HTML).toContain('Son güncelleme: 27.10.2026');
    expect(PRIVACY_PAGE_HTML).toContain('Last updated: 27.10.2026');
    expect(PRIVACY_PAGE_HTML).toContain('<article lang="en" id="en">');
    for (const words of [
      'Mesajlar, anlık fotoğraflar ve hikayeler',
      'Bildirdiğin içerik',
      'Engelleme listen',
      'Messages, instant photos and stories',
      'Content you report',
      'support@otenus.com',
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
