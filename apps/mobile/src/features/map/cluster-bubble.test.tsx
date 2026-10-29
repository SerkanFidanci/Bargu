import { configure, fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '@/i18n';
import { EffectsPaused } from '@/theme/effects';

// What the footprints and the burst (Skia) draw is not tested here.
jest.mock('./footprints', () => ({ Footprints: () => null }));
jest.mock('./meet-burst', () => ({ MeetBurst: () => null }));

import { ClusterBubble, type TogetherPerson } from './cluster-bubble';

// The looks and the count are hidden from the screen reader (the pill reads it all out).
configure({ defaultIncludeHiddenElements: true });

const person = (id: string, name: string, extra: Partial<TogetherPerson['marker']> = {}) => ({
  id,
  marker: { name, avatar: null, userId: id, ...extra },
});

const bubble = (
  people: TogetherPerson[],
  everyone: string[],
  options: { age?: number; onList?: () => void } = {},
) => (
  <EffectsPaused.Provider value>
    <ClusterBubble
      people={people}
      more={everyone.length - people.length}
      offsets={people.map(() => ({ x: 0, y: 0 }))}
      everyone={everyone}
      age={options.age}
      onList={options.onList ?? jest.fn()}
    />
  </EffectsPaused.Provider>
);

describe('a group pin (the owner, 2026-10-29)', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('tr');
  });

  it('leads with one pin, the other beside it, each in their own look, and says how many', async () => {
    await render(
      bubble(
        [
          person('me', 'Sen', { look: { ring: 'stripes', until: Infinity } }),
          person('ayse', 'Ayşe', { look: { frame: 'neon', until: Infinity } }),
        ],
        ['Sen', 'Ayşe'],
      ),
    );
    expect(screen.getAllByTestId('pin-look')).toHaveLength(2);
    expect(screen.getByTestId('pin-look-ring-stripes')).toBeTruthy();
    expect(screen.getByTestId('pin-look-frame-neon')).toBeTruthy();
    expect(screen.getByText('2 kişi')).toBeTruthy();
    expect(screen.queryByTestId('together-more')).toBeNull();
    expect(screen.getByLabelText('Sen, canlı konum')).toBeTruthy();
    expect(screen.getByLabelText('Ayşe, canlı konum')).toBeTruthy();
  });

  it('shows three faces, counts the rest, and lists everyone from the pill or the count', async () => {
    const onList = jest.fn();
    await render(
      bubble(
        [person('me', 'Sen'), person('ayse', 'Ayşe'), person('cem', 'Cem')],
        ['Sen', 'Ayşe', 'Cem', 'Deniz', 'Ece', 'Fatih'],
        { onList },
      ),
    );
    expect(screen.getByText('+3')).toBeTruthy();
    expect(screen.getByText('6 kişi')).toBeTruthy();
    await fireEvent.press(
      screen.getByRole('button', {
        name: '6 kişi bir arada: Sen, Ayşe, Cem, Deniz, Ece, Fatih. Hepsini görmek için dokun.',
      }),
      { nativeEvent: { pageX: 10, pageY: 20 } },
    );
    expect(onList).toHaveBeenLastCalledWith({ x: 10, y: 20 });
    await fireEvent.press(screen.getByTestId('together-more'), {
      nativeEvent: { pageX: 30, pageY: 40 },
    });
    expect(onList).toHaveBeenLastCalledWith({ x: 30, y: 40 });
  });

  it('says how old when every location here is old, nothing under each face', async () => {
    const { rerender } = await render(
      bubble(
        [
          person('ayse', 'Ayşe', { staleMinutes: 190 }),
          person('cem', 'Cem', { staleMinutes: 200 }),
        ],
        ['Ayşe', 'Cem'],
        { age: 190 },
      ),
    );
    expect(screen.getByText('2 kişi • 3 sa')).toBeTruthy();
    expect(screen.queryByTestId('marker-age')).toBeNull();
    await rerender(
      bubble(
        [person('ayse', 'Ayşe', { staleMinutes: 25 }), person('cem', 'Cem', { staleMinutes: 40 })],
        ['Ayşe', 'Cem'],
        { age: 25 },
      ),
    );
    expect(screen.getByText('2 kişi • 25 dk')).toBeTruthy();
  });

  it('is in English too', async () => {
    await i18n.changeLanguage('en');
    const view = await render(
      bubble(
        [person('me', 'You'), person('ayse', 'Ayşe'), person('cem', 'Cem')],
        ['You', 'Ayşe', 'Cem', 'Deniz'],
        { age: 190 },
      ),
    );
    try {
      expect(screen.getByText('4 people • 3 h')).toBeTruthy();
      expect(screen.getByText('+1')).toBeTruthy();
    } finally {
      // Off the screen first: a language change under a mounted screen is an update outside act().
      await view.unmount();
      await i18n.changeLanguage('tr');
    }
  });
});
