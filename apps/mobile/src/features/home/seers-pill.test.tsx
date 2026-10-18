import type { Me } from '@bargu/schemas';
import { fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '@/i18n';

import { Dock } from './dock';
import { SeersPill, sharingNow } from './seers-pill';

const ada = { id: 'ada', name: 'Ada', avatar: null };

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});

describe('"who sees me" (BARGU_PLAN §2, the theme of 2026-10-18)', () => {
  it('says "shared now" only when it is: never as a ghost, to nobody, or without the permission', () => {
    const base = { ghost: 'off', seers: 2, permission: 'granted' } as const;
    expect(sharingNow(base)).toBe('shared');
    expect(sharingNow({ ...base, ghost: 'hide' })).toBe('hidden');
    expect(sharingNow({ ...base, ghost: 'freeze' })).toBe('frozen');
    expect(sharingNow({ ...base, seers: 0 })).toBe('nobody');
    expect(sharingNow({ ...base, permission: 'blocked' })).toBe('noPermission');
    expect(sharingNow({ ...base, permission: 'undetermined' })).toBe('noPermission');
    // Before the permission is known (the app just opened): not "shared", and so no dot (QA 24 B-1).
    expect(sharingNow({ ...base, permission: 'unknown' })).toBe('checking');
    // A ghost is told as one whatever else holds.
    expect(sharingNow({ ghost: 'hide', seers: 0, permission: 'blocked' })).toBe('hidden');
    // Every circle paused or sharing off: nobody gets it (seersOf counts none), so not "shared".
    expect(sharingNow({ ghost: 'off', seers: 0, permission: 'granted' })).not.toBe('shared');
  });

  it.each([
    ['off', 'granted', 'Konumun şu an paylaşılıyor'],
    ['hide', 'granted', 'Konumun gizli: kimseye gönderilmiyor'],
    ['freeze', 'granted', 'Konumun donduruldu: son konumun duruyor'],
    ['off', 'blocked', 'Konum izni yok: konumun gönderilmiyor'],
    ['off', 'unknown', 'Kontrol ediliyor…'],
  ] as const)('reads ghost %s, permission %s as "%s"', async (ghost, permission, text) => {
    await render(
      <SeersPill seers={[ada]} ghost={ghost} permission={permission} onPress={jest.fn()} />,
    );
    expect(screen.getByTestId('seers-now').props.children).toBe(text);
    expect(screen.getByTestId('seers-pill').props.accessibilityLabel).toContain(text);
  });

  it('with nobody seeing, says so on both lines', async () => {
    await render(<SeersPill seers={[]} ghost="off" permission="granted" onPress={jest.fn()} />);
    expect(screen.getByTestId('seers-now').props.children).toBe('Konumun kimseyle paylaşılmıyor');
  });
});

describe('the dock', () => {
  it('marks where the user is: the circles, or Me', async () => {
    const me: Me = {
      userId: '0190f7a4-1111-7111-8111-000000000001',
      username: 'seko',
      displayName: 'Seko',
      avatar: null,
      device: { id: '0190f7a4-1111-7111-8111-000000000002', platform: 'android', attested: true },
      passkeys: 0,
    };
    const props = {
      me,
      onCircles: jest.fn(),
      onAdd: jest.fn(),
      onMe: jest.fn(),
      addOpen: false,
      requests: 0,
    };
    const view = await render(<Dock {...props} active="circles" />);
    expect(screen.getByTestId('dock-circles').props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByTestId('dock-me').props.accessibilityState).toEqual({ selected: false });
    await view.rerender(<Dock {...props} active="me" />);
    expect(screen.getByTestId('dock-me').props.accessibilityState).toEqual({ selected: true });
    await fireEvent.press(screen.getByTestId('dock-circles'));
    expect(props.onCircles).toHaveBeenCalled();
  });
});
