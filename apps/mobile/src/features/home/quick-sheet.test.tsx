import { fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '@/i18n';

import { QuickSheet } from './quick-sheet';

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});

describe('the "+" quick things (the PM report T2, 2026-10-29)', () => {
  it('offers a photo, a friend, a meeting, "Güvendeyim" and "Yakındayım", each one tap', async () => {
    const handlers = {
      onPhoto: jest.fn(),
      onAddFriend: jest.fn(),
      onMeeting: jest.fn(),
      onSafe: jest.fn(),
      onNear: jest.fn(),
    };
    await render(<QuickSheet {...handlers} nearReady onDismiss={jest.fn()} />);
    expect(screen.getByText('Hızlı işler')).toBeTruthy();
    expect(
      ['photo', 'friend', 'meeting', 'safe', 'near'].map(
        (key) => screen.getByTestId(`quick-${key}`).props.accessibilityLabel as string,
      ),
    ).toEqual(['Fotoğraf çek', 'Arkadaş ekle', 'Buluşma', 'Güvendeyim', 'Yakındayım']);

    await fireEvent.press(screen.getByTestId('quick-photo'));
    await fireEvent.press(screen.getByTestId('quick-friend'));
    await fireEvent.press(screen.getByTestId('quick-meeting'));
    await fireEvent.press(screen.getByTestId('quick-safe'));
    await fireEvent.press(screen.getByTestId('quick-near'));
    for (const handler of Object.values(handlers)) expect(handler).toHaveBeenCalledTimes(1);
  });

  it('shows "Yakındayım" faint when it can go nowhere now, still a tap from why (ADR 0037 §6)', async () => {
    const onNear = jest.fn();
    await render(
      <QuickSheet
        onPhoto={jest.fn()}
        onAddFriend={jest.fn()}
        onMeeting={jest.fn()}
        onSafe={jest.fn()}
        onNear={onNear}
        nearReady={false}
        onDismiss={jest.fn()}
      />,
    );
    const tile = screen.getByTestId('quick-near');
    expect(tile.props.accessibilityHint).toBe('Şu an gönderilemez, nedenini görmek için dokun');
    await fireEvent.press(tile);
    expect(onNear).toHaveBeenCalledTimes(1);
  });
});
