import { readFileSync } from 'node:fs';

import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import ServerKnowsScreen from '@/app/(app)/server-knows';
import i18n from '@/i18n';

import { SERVER_CANNOT_SEE, SERVER_SEES, SERVER_SEES_KEYS } from './server-knows';

jest.mock('expo-router', () => ({ router: { back: jest.fn() } }));
jest.mock('@/config/env', () => ({
  env: { apiUrl: 'https://api.test', mapUrl: 'https://api.test/map', appVersion: '0.0.0' },
  DEV_TOOLS_ENABLED: false,
}));

/** The rows of THREAT_MODEL's accepted leaks ("Kabul edilen sızıntılar"), by their first column. */
function acceptedLeaks(): Set<string> {
  // Tests run in apps/mobile: the docs are two levels up.
  const model = readFileSync('../../docs/THREAT_MODEL.md', 'utf8');
  const start = model.indexOf('## Kabul edilen sızıntılar');
  const end = model.indexOf('\n## ', start + 1);
  const section = model.slice(start, end < 0 ? undefined : end);
  return new Set(
    section
      .split('\n')
      .filter((line) => line.startsWith('| '))
      .map((line) => line.split('|')[1]?.trim() ?? ''),
  );
}

describe('"Sunucu ne biliyor?" (N2, QA-42)', () => {
  afterEach(async () => {
    await i18n.changeLanguage('tr');
  });

  it('rests every group it names on an accepted leak of THREAT_MODEL', () => {
    const leaks = acceptedLeaks();
    expect(leaks.size).toBeGreaterThan(20);
    for (const [group, rows] of Object.entries(SERVER_SEES)) {
      for (const row of rows) {
        expect([group, leaks.has(row) ? row : `missing: ${row}`]).toEqual([group, row]);
      }
    }
  });

  it('lists the groups and what it cannot see, every line in both languages', async () => {
    for (const language of ['tr', 'en']) {
      await i18n.changeLanguage(language);
      const view = await render(<ServerKnowsScreen />);
      for (const key of [...SERVER_SEES_KEYS, ...SERVER_CANNOT_SEE]) {
        expect(screen.getByTestId(`server-knows-${key}`)).toBeTruthy();
      }
      await view.unmount();
    }
  });

  it('says what it sees, never that it cannot see who gets the location, and links the full list', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await i18n.changeLanguage('tr');
    await render(<ServerKnowsScreen />);
    expect(screen.getByText(/anahtarlı özeti/)).toBeTruthy();
    expect(screen.getByText(/kim kime ya da hangi çembere ne zaman yazdı/)).toBeTruthy();
    expect(screen.getByText(/hangi çembere ne zaman ve ne sıklıkta konum gittiği/)).toBeTruthy();
    expect(screen.queryByText(/Hepsi burada/)).toBeNull();
    expect(screen.queryByText(/Kime, ne kadar süre/)).toBeNull();
    expect(screen.queryByText(/hayalet modun/)).toBeNull();
    await fireEvent.press(screen.getByTestId('server-knows-policy'));
    expect(open).toHaveBeenCalledWith('https://api.test/gizlilik');
    open.mockRestore();
  });
});
