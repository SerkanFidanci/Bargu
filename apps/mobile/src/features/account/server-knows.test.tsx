import { render, screen } from '@testing-library/react-native';

import ServerKnowsScreen from '@/app/(app)/server-knows';
import i18n from '@/i18n';

import { SERVER_CANNOT_SEE, SERVER_SEES } from './server-knows';

jest.mock('expo-router', () => ({ router: { back: jest.fn() } }));

describe('"Sunucu ne biliyor?" (N2)', () => {
  afterEach(async () => {
    await i18n.changeLanguage('tr');
  });

  it('lists what the server sees and what it cannot, every line in both languages', async () => {
    for (const language of ['tr', 'en']) {
      await i18n.changeLanguage(language);
      const view = await render(<ServerKnowsScreen />);
      for (const key of [...SERVER_SEES, ...SERVER_CANNOT_SEE]) {
        expect(screen.getByTestId(`server-knows-${key}`)).toBeTruthy();
      }
      for (const key of SERVER_SEES) {
        expect(i18n.t(`serverKnows.sees.${key}`)).not.toBe(`serverKnows.sees.${key}`);
      }
      for (const key of SERVER_CANNOT_SEE) {
        expect(i18n.t(`serverKnows.cannot.${key}`)).not.toBe(`serverKnows.cannot.${key}`);
      }
      await view.unmount();
    }
  });

  it('says plainly what it sees, as THREAT_MODEL accepts: the email kept as a keyed hash, the timing, the token', async () => {
    await i18n.changeLanguage('tr');
    await render(<ServerKnowsScreen />);
    expect(screen.getByText(/anahtarlı özeti durur/)).toBeTruthy();
    expect(screen.getByText(/ne zaman ve ne sıklıkta gönderdiğin/)).toBeTruthy();
    expect(screen.getByText(/Bildirim jetonun/)).toBeTruthy();
    expect(screen.getByText(/Konumun: telefonunda şifrelenir, sunucu okuyamaz/)).toBeTruthy();
  });
});
