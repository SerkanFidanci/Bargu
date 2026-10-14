import { fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '@/i18n';

import { FriendPicker } from './friend-picker';
import type { Friend } from './names';

const ali: Friend = { userId: 'a', username: 'ali', name: 'Ali', avatar: null };
const veli: Friend = { userId: 'v', username: 'veli', name: 'Veli', avatar: null };

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});

describe('FriendPicker', () => {
  it('picks friends with one tap and shows who is already in', async () => {
    const onToggle = jest.fn();
    await render(
      <FriendPicker
        friends={[ali, veli]}
        selected={new Set(['a'])}
        onToggle={onToggle}
        locked={new Map([['v', 'Çemberde']])}
      />,
    );
    const aliRow = screen.getByRole('checkbox', { name: 'Ali, @ali' });
    expect(aliRow.props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.press(aliRow);
    expect(onToggle).toHaveBeenCalledWith(ali);
    // Already in the circle: shown with the reason, not selectable.
    expect(screen.queryByRole('checkbox', { name: 'Veli, @veli' })).toBeNull();
    expect(screen.getByLabelText('Veli, Çemberde')).toBeTruthy();
  });

  it('offers a search once the list gets long', async () => {
    const many = Array.from({ length: 8 }, (_, index) => ({
      userId: String(index),
      username: `kisi${String(index)}`,
      name: index === 3 ? 'Zeynep' : `Kişi ${String(index)}`,
      avatar: null,
    }));
    await render(<FriendPicker friends={many} selected={new Set()} onToggle={jest.fn()} />);
    await fireEvent.changeText(screen.getByLabelText('Arkadaş ara'), 'zey');
    expect(screen.getByText('Zeynep')).toBeTruthy();
    expect(screen.queryByText('Kişi 1')).toBeNull();
  });
});
