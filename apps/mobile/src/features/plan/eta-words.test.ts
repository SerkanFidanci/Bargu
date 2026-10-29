import i18n from '@/i18n';

import { etaWords } from './eta-words';

const NOW = new Date(2026, 9, 29, 21, 0).getTime();
const MIN = 60_000;

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});

describe('an arrival as people say it (Ö12)', () => {
  it('says "yaklaşık", in minutes within the hour, else the time', () => {
    const t = i18n.t.bind(i18n);
    expect(etaWords(t, { at: NOW + 4 * MIN, late: 0 }, NOW, 'tr')).toBe('Yaklaşık 4 dk');
    expect(etaWords(t, { at: NOW + 20 * 1000, late: 0 }, NOW, 'tr')).toBe('Yaklaşık 1 dk');
    expect(etaWords(t, { at: NOW + 95 * MIN, late: 0 }, NOW, 'tr')).toBe('Yaklaşık 22:35');
    expect(etaWords(t, { at: NOW + 25 * MIN, late: 15 }, NOW, 'tr')).toBe(
      'Yaklaşık 25 dk · 15 dk geç',
    );
  });
});
