import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import i18n from '@/i18n';

const mockSetting = jest.fn(() => Promise.resolve({ on: true }));
const mockSet = jest.fn((on: boolean) => Promise.resolve({ on }));
jest.mock('./rollcall-api', () => ({
  rollcallApi: {
    setting: () => mockSetting(),
    setSetting: (on: boolean) => mockSet(on),
  },
}));

import { RollcallSettingToggle } from './rollcall-setting';

const show = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RollcallSettingToggle />
    </QueryClientProvider>,
  );

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});

describe('"Etkinlik yoklamaları" (docs/ADR/0040 §6)', () => {
  it('is anyone’s to turn off, and says so in general words', async () => {
    await show();
    const toggle = await screen.findByTestId('rollcall-setting');
    expect(screen.getByText('Etkinlik yoklamaları')).toBeTruthy();
    expect(
      screen.getByText(/8 kişiden büyük etkinliklerde 18 yaşından küçükler için kapalıdır/),
    ).toBeTruthy();
    await fireEvent(toggle, 'onChange', false);
    await waitFor(() => {
      expect(mockSet).toHaveBeenCalledWith(false);
    });
  });
});
