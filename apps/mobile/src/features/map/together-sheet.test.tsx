import { fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '@/i18n';

import { type GroupMember, TogetherSheet } from './together-sheet';

const people: GroupMember[] = [
  { userId: 'me', name: 'Seko', avatar: null, me: true },
  { userId: 'ayse', name: 'Ayşe', avatar: null, me: false, activity: 'walking' },
  { userId: 'cem', name: 'Cem', avatar: null, me: false, staleMinutes: 12 },
];

describe('the window of people standing together (2026-10-16)', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('tr');
  });

  it('lists everyone there, the user as "Sen", and opens the one picked', async () => {
    const onPick = jest.fn();
    await render(<TogetherSheet people={people} onPick={onPick} />);
    expect(screen.getByText('Burada 3 kişi')).toBeTruthy();
    expect(screen.getByText('Sen')).toBeTruthy();
    expect(screen.getByText('Şimdi burada')).toBeTruthy();
    expect(screen.getByText('12 dk önce buradaydı')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('together-ayse'));
    expect(onPick).toHaveBeenCalledWith('ayse');
    // The user's own row opens nothing.
    await fireEvent.press(screen.getByTestId('together-me'));
    expect(onPick).toHaveBeenCalledTimes(1);
  });
});
