import { fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '@/i18n';

import { QuickSheet } from './quick-sheet';

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});

describe('the "+" quick things (the PM report T2, 2026-10-29)', () => {
  it('offers a photo, a friend, a meeting and "Güvendeyim", each one tap', async () => {
    const handlers = {
      onPhoto: jest.fn(),
      onAddFriend: jest.fn(),
      onMeeting: jest.fn(),
      onSafe: jest.fn(),
    };
    await render(<QuickSheet {...handlers} onDismiss={jest.fn()} />);
    expect(screen.getByText('Hızlı işler')).toBeTruthy();
    expect(
      ['photo', 'friend', 'meeting', 'safe'].map(
        (key) => screen.getByTestId(`quick-${key}`).props.accessibilityLabel as string,
      ),
    ).toEqual(['Fotoğraf çek', 'Arkadaş ekle', 'Buluşma', 'Güvendeyim']);

    await fireEvent.press(screen.getByTestId('quick-photo'));
    await fireEvent.press(screen.getByTestId('quick-friend'));
    await fireEvent.press(screen.getByTestId('quick-meeting'));
    await fireEvent.press(screen.getByTestId('quick-safe'));
    for (const handler of Object.values(handlers)) expect(handler).toHaveBeenCalledTimes(1);
  });
});
