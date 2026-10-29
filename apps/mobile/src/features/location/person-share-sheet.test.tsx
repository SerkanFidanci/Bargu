import { fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '@/i18n';

import { untilChoices } from './person-share';
import { DEFAULT_SHARING, type SharingSettings, useSharing } from './sharing';

// The session saves and sends; here a change lands in the store, as on the phone.
jest.mock('./location-session', () => {
  const sharing = jest.requireActual<typeof import('./sharing')>('./sharing');
  return {
    updateSharing: (change: (current: SharingSettings) => SharingSettings) => {
      sharing.useSharing.setState(change(sharing.useSharing.getState()), true);
    },
  };
});
const mockSchedule = jest.fn<Promise<void>, [string, number, { title: string; body: string }]>(() =>
  Promise.resolve(),
);
const mockCancel = jest.fn<Promise<void>, [string]>(() => Promise.resolve());
jest.mock('./share-ends', () => ({
  scheduleShareEnd: (circleId: string, at: number, text: { title: string; body: string }) =>
    mockSchedule(circleId, at, text),
  cancelShareEnd: (circleId: string) => mockCancel(circleId),
}));

import { PersonShareSheet } from './person-share-sheet';

const PAIR = '0190a8a0-0000-7000-8000-0000000000d1';
const checked = (mode: string) =>
  (screen.getByTestId(`person-share-${mode}`).props.accessibilityState as { checked: boolean })
    .checked;

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});
beforeEach(() => {
  jest.clearAllMocks();
  useSharing.setState(DEFAULT_SHARING, true);
});

describe("one friend's sharing sheet (docs/ADR/0038)", () => {
  it('offers four choices, the current one ticked, each applied at once', async () => {
    await render(<PersonShareSheet target={{ circleId: PAIR, name: 'Ayşe' }} />);
    expect(screen.getByText('Yalnız Ayşe için. Gruplarındaki ayarlar değişmez.')).toBeTruthy();
    expect(['always', 'until', 'frozen', 'off'].map(checked)).toEqual([true, false, false, false]);
    await fireEvent.press(screen.getByTestId('person-share-frozen'));
    expect(useSharing.getState().circles[PAIR]).toMatchObject({ sharing: true, frozen: true });
    expect(checked('frozen')).toBe(true);
    expect(mockCancel).toHaveBeenCalledWith(PAIR);
    await fireEvent.press(screen.getByTestId('person-share-off'));
    expect(useSharing.getState().circles[PAIR]).toMatchObject({ sharing: false });
  });

  it('shares until a time, and sets the line for its end on this phone', async () => {
    const before = Date.now();
    await render(<PersonShareSheet target={{ circleId: PAIR, name: 'Ayşe' }} />);
    await fireEvent.press(screen.getByTestId('person-share-until'));
    const until = useSharing.getState().circles[PAIR]?.until ?? 0;
    expect(untilChoices(before)).toContain(until);
    expect(until - before).toBeGreaterThanOrEqual(2 * 3_600_000);
    expect(mockSchedule).toHaveBeenCalledWith(PAIR, until, {
      title: 'Bargu',
      body: 'Ayşe ile süreli paylaşım bitti',
    });
    expect(checked('until')).toBe(true);
    // The time can be moved on the slider.
    expect(screen.getByTestId('person-share-until-slider')).toBeTruthy();
  });

  it('says a ghost is above it all', async () => {
    useSharing.setState({ ...DEFAULT_SHARING, ghost: 'freeze' }, true);
    await render(<PersonShareSheet target={{ circleId: PAIR, name: 'Ayşe' }} />);
    expect(screen.getByText(/Hayalet modu açık: şu an kimse yeni konumunu almıyor/)).toBeTruthy();
  });
});
