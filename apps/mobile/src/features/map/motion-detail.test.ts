import i18n from '@/i18n';
import { markerDetailText } from '@/ui/avatar-marker';

import { motionDetail } from './motion-detail';

const NOW = Date.UTC(2026, 9, 16, 12, 0);
const MIN = 60_000;

describe('the line under someone (proje sahibi 2026-10-16)', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('tr');
  });

  it('says the speed while moving, rounded to 5 km/h, from 1 m/s', () => {
    expect(motionDetail({ spd: 11.7, since: NOW - 3 * MIN }, NOW)).toEqual({
      kind: 'speed',
      kmh: 40,
    });
    expect(motionDetail({ spd: 1.1 }, NOW)).toEqual({ kind: 'speed', kmh: 5 });
    // Slower than that is standing (a walk at a crawl, GPS drift): how long they stayed instead.
    expect(motionDetail({ spd: 0.6, since: NOW - 12 * MIN }, NOW)).toEqual({
      kind: 'stay',
      unit: 'minutes',
      count: 12,
    });
  });

  it('says how long they have stayed, in minutes, hours or days', () => {
    expect(motionDetail({ spd: null, since: NOW - 135 * MIN }, NOW)).toEqual({
      kind: 'stay',
      unit: 'hours',
      count: 2,
    });
    expect(motionDetail({ since: NOW - 50 * 60 * MIN }, NOW)).toEqual({
      kind: 'stay',
      unit: 'days',
      count: 2,
    });
    // Just arrived, or a coarse location (no speed, no stay): nothing.
    expect(motionDetail({ since: NOW - 20_000 }, NOW)).toBeUndefined();
    expect(motionDetail({}, NOW)).toBeUndefined();
  });

  it('reads short on the map and in full to a screen reader', () => {
    const t = i18n.t.bind(i18n);
    expect(markerDetailText({ kind: 'speed', kmh: 40 }, t)).toBe('40 km/sa');
    expect(markerDetailText({ kind: 'stay', unit: 'hours', count: 2 }, t)).toBe('2 sa');
    expect(markerDetailText({ kind: 'stay', unit: 'days', count: 1 }, t)).toBe('1 gün');
    expect(markerDetailText({ kind: 'stay', unit: 'minutes', count: 12 }, t, true)).toBe(
      '12 dakikadır aynı yerde',
    );
  });
});
