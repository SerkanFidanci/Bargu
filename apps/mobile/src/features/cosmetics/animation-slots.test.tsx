import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { cosmeticFx } from '@/theme';

import { granted, useAnimationSlot, useSlots } from './animation-slots';

beforeEach(() => {
  useSlots.setState({ claims: [] }, true);
});

/** One pin that says whether it may move its look now. */
function Pin({ id, wanted, first = false }: { id: string; wanted: boolean; first?: boolean }) {
  const moving = useAnimationSlot(id, wanted, first);
  return <Text testID={id}>{moving ? 'moves' : 'still'}</Text>;
}

const pins = (ids: readonly string[], stopped: readonly string[] = [], own = '') => (
  <>
    {ids.map((id) => (
      <Pin key={id} id={id} wanted={!stopped.includes(id)} first={id === own} />
    ))}
  </>
);
const says = (ids: readonly string[]) =>
  ids.map((id) => screen.getByTestId(id).props.children as string);

describe('which pins may move their look (docs/ADR/0025, the pin addendum)', () => {
  it('lets only the first few move, in the order they asked', () => {
    const claims = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, first: false }));
    expect([...granted(claims)]).toEqual(['a', 'b', 'c']);
    expect(cosmeticFx.maxAnimated).toBe(3);
  });

  it('always lets the own pin move, ahead of those who asked before it', () => {
    const claims = [
      { id: 'a', first: false },
      { id: 'b', first: false },
      { id: 'c', first: false },
      { id: 'me', first: true },
    ];
    expect([...granted(claims)]).toEqual(['me', 'a', 'b']);
  });

  it('lets three of five pins move, and gives a place on when a pin leaves or stops wanting', async () => {
    const all = ['a', 'b', 'c', 'd', 'e'];
    const view = await render(pins(all));
    expect(says(all)).toEqual(['moves', 'moves', 'moves', 'still', 'still']);
    // The first one leaves the map: the fourth takes its place.
    await view.rerender(pins(all.slice(1)));
    expect(says(all.slice(1))).toEqual(['moves', 'moves', 'moves', 'still']);
    // The second stops wanting (calm mode, an old location): the last one gets the place.
    await view.rerender(pins(all.slice(1), ['b']));
    expect(says(all.slice(1))).toEqual(['still', 'moves', 'moves', 'moves']);
  });

  it('keeps a place for the own pin even when it came last', async () => {
    const all = ['a', 'b', 'c', 'me'];
    await render(pins(all, [], 'me'));
    expect(says(all)).toEqual(['moves', 'moves', 'still', 'moves']);
  });

  it('takes no place for a pin that wants none', async () => {
    await render(pins(['still'], ['still']));
    expect(says(['still'])).toEqual(['still']);
    expect(useSlots.getState().claims).toEqual([]);
  });
});
