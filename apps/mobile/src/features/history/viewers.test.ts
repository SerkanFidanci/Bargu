import { card, circleOf, memoryStore, somebody } from '../location/test-support';
import { DEFAULT_SHARING, historyOn, type SharingSettings } from '../location/sharing';
import {
  forgetViewer,
  historyAudience,
  knownViewers,
  newViewers,
  rememberViewers,
  setKnownViewers,
} from './viewers';

const now = 1_791_880_200_000;
const exact = { sharing: true, precision: 'exact', until: null } as const;

describe('who sees the history (BARGU_PLAN, docs/ADR/0019)', () => {
  it('starts off: joining a circle is not consent to history', () => {
    const [me, ali] = [somebody(), somebody()];
    const circle = circleOf([me, ali]);
    expect(historyOn(DEFAULT_SHARING, circle.id, now)).toBe(false);
    expect(historyAudience([circle], DEFAULT_SHARING, me.userId)).toEqual([]);
    const on: SharingSettings = {
      ghost: 'off',
      circles: { [circle.id]: { ...exact, history: true } },
    };
    expect(historyOn(on, circle.id, now)).toBe(true);
    // Neighbourhood precision, a ghost, or sharing paused: nothing is written.
    for (const settings of [
      { ...on, circles: { [circle.id]: { ...exact, precision: 'neighborhood', history: true } } },
      { ...on, ghost: 'hide' },
      { ...on, circles: { [circle.id]: { ...exact, sharing: false, history: true } } },
    ] satisfies SharingSettings[]) {
      expect(historyOn(settings, circle.id, now)).toBe(false);
    }
  });

  it('lists every circle it is on for, with the members who can see it', () => {
    const [me, ali, bora, cem] = [somebody(), somebody(), somebody(), somebody()];
    const family = circleOf([me, ali, bora]);
    const work = circleOf([me, cem]);
    const withInvite = { ...family, members: [card(me), card(ali), card(bora, 'invited')] };
    const settings: SharingSettings = {
      ghost: 'off',
      // Paused sharing still counts: the circle keeps what it has.
      circles: {
        [family.id]: { ...exact, sharing: false, history: true },
        [work.id]: { ...exact, history: false },
      },
    };
    const audience = historyAudience([withInvite, work], settings, me.userId);
    expect(audience.map((entry) => entry.circle.id)).toEqual([family.id]);
    // Only active members other than the user: someone still invited sees nothing yet.
    expect(audience[0]?.viewers.map((member) => member.userId)).toEqual([ali.userId]);
  });

  it('tells about newcomers once, never about those there when it was turned on', () => {
    const [me, ali, bora] = [somebody(), somebody(), somebody()];
    const store = memoryStore();
    const circle = circleOf([me, ali]);
    const settings: SharingSettings = {
      ghost: 'off',
      circles: { [circle.id]: { ...exact, history: true } },
    };
    // Just turned on: Ali was already there.
    setKnownViewers(store, circle.id, [ali.userId]);
    expect(newViewers(knownViewers(store), historyAudience([circle], settings, me.userId))).toEqual(
      [],
    );

    // Bora joins: told once.
    const grown = { ...circle, members: [...circle.members, card(bora)] };
    const audience = historyAudience([grown], settings, me.userId);
    expect(newViewers(knownViewers(store), audience).map((entry) => entry.viewer.userId)).toEqual([
      bora.userId,
    ]);
    rememberViewers(store, audience);
    expect(newViewers(knownViewers(store), audience)).toEqual([]);

    // A circle never seen before (history just turned on elsewhere) tells nothing.
    expect(newViewers({}, audience)).toEqual([]);
    setKnownViewers(store, circle.id, null);
    expect(knownViewers(store)).toEqual({});
  });

  it('forgets a person no circle is shared with any more: met again, they are new and told about', () => {
    const [me, ali, bora] = [somebody(), somebody(), somebody()];
    const store = memoryStore();
    const circle = circleOf([me, ali, bora]);
    const settings: SharingSettings = {
      ghost: 'off',
      circles: { [circle.id]: { ...exact, history: true } },
    };
    const audience = historyAudience([circle], settings, me.userId);
    rememberViewers(store, audience);
    expect(newViewers(knownViewers(store), audience)).toEqual([]);

    forgetViewer(store, ali.userId);

    expect(knownViewers(store)).toEqual({ [circle.id]: [bora.userId] });
    expect(newViewers(knownViewers(store), audience).map((entry) => entry.viewer.userId)).toEqual([
      ali.userId,
    ]);
    // Nobody to forget: the vault is not written.
    const before = store.get('history:viewers:v1');
    forgetViewer(store, 'nobody');
    expect(store.get('history:viewers:v1')).toBe(before);
  });
});
