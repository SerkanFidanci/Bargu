import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import i18n from '@/i18n';

jest.mock('@/config/env', () => ({
  env: { apiUrl: 'https://api.test', mapUrl: 'https://api.test/map', appVersion: '1.2.3' },
  DEV_TOOLS_ENABLED: false,
}));
// expo-router's native stack needs a native view jest does not have on Linux (CI).
jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() } }));
const mockToast = jest.fn<undefined, [string]>();
jest.mock('@/ui/toast', () => ({
  toast: {
    error: (text: string) => {
      mockToast(text);
    },
  },
}));

import HelpScreen from '@/app/(app)/settings/help';

import { phoneModel, reportMail, SUPPORT_EMAIL } from './report';

const LABELS = { subject: 'Bargu sorun bildirimi', version: 'Sürüm', phone: 'Telefon' };

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});
beforeEach(() => {
  jest.clearAllMocks();
});

describe('"Sorun bildir" (the PM report Ö1, 2026-10-29)', () => {
  it('is an e-mail to support: the words, the version and the phone, nothing else', () => {
    const mail = reportMail('  Harita açılmıyor  ', LABELS);
    expect(mail.startsWith(`mailto:${SUPPORT_EMAIL}?subject=`)).toBe(true);
    const query = new URLSearchParams(mail.slice(mail.indexOf('?') + 1));
    expect(query.get('subject')).toBe('Bargu sorun bildirimi');
    expect(query.get('body')).toBe(
      ['Harita açılmıyor', '', '—', 'Sürüm: 1.2.3', `Telefon: ${phoneModel()}`].join('\n'),
    );
  });

  it('opens the e-mail app with it once something is written', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await render(<HelpScreen />);
    expect(screen.getByTestId('report-send').props.accessibilityState).toMatchObject({
      disabled: true,
    });
    await fireEvent.changeText(screen.getByTestId('report-words'), 'Mesaj gitmedi');
    await fireEvent.press(screen.getByTestId('report-send'));
    expect(open).toHaveBeenCalledWith(reportMail('Mesaj gitmedi', LABELS));
    expect(mockToast).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it('gives the address when no e-mail app opens', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no app'));
    await render(<HelpScreen />);
    await fireEvent.changeText(screen.getByTestId('report-words'), 'Bir sorun');
    await fireEvent.press(screen.getByTestId('report-send'));
    expect(mockToast).toHaveBeenCalledWith(
      'E-posta uygulaması açılamadı. support@otenus.com adresine yazabilirsin.',
    );
    open.mockRestore();
  });
});
