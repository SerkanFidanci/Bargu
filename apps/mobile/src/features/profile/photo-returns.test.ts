import { generateDeviceKeys, randomUuid } from '@bargu/crypto';

import { card, circleOf, somebody } from '../location/test-support';
import { MAX_RETURNS, returnsFor, withCurrentDevices } from './photo-returns';

const key = (id = randomUuid()) => ({ id, key: 'K'.repeat(43) });

describe('handing photo keys back to a new phone', () => {
  const [me, ada, bo] = [somebody(), somebody(), somebody()];
  const trustAll = () => true;

  it('gives a member their key back once their phone changed, not before', () => {
    const circle = circleOf([me, ada]);
    const adaKey = key();
    const known = { [ada.userId]: { ...adaKey, deviceId: ada.device.deviceId } };
    expect(returnsFor(circle, known, trustAll, me.userId)).toEqual([]);

    // Ada reinstalled: same account, another device.
    const adaNew = { ...ada, device: generateDeviceKeys(randomUuid()) };
    const changed = { ...circle, members: [card(me), card(adaNew)] };
    expect(returnsFor(changed, known, trustAll, me.userId)).toEqual([
      { userId: ada.userId, ...adaKey },
    ]);
    // Delivered to her current phone: not again.
    const delivered = withCurrentDevices(known, [changed], new Set([ada.userId]));
    expect(delivered[ada.userId]?.deviceId).toBe(adaNew.device.deviceId);
    expect(returnsFor(changed, delivered, trustAll, me.userId)).toEqual([]);
  });

  it('waits until the new phone is trusted (its changed identity acknowledged)', () => {
    const adaNew = { ...ada, device: generateDeviceKeys(randomUuid()) };
    const circle = circleOf([me, adaNew]);
    const known = { [ada.userId]: { ...key(), deviceId: ada.device.deviceId } };
    expect(returnsFor(circle, known, () => false, me.userId)).toEqual([]);
  });

  it('records the device for keys learnt before, without giving anything back', () => {
    const circle = circleOf([me, ada]);
    const legacy = { [ada.userId]: key() };
    const filled = withCurrentDevices(legacy, [circle]);
    expect(filled[ada.userId]?.deviceId).toBe(ada.device.deviceId);
    expect(returnsFor(circle, filled, trustAll, me.userId)).toEqual([]);
  });

  it('never returns to this phone itself, to invited people, or more than fits', () => {
    const others = [ada, bo, somebody()];
    const circle = circleOf([me, ...others]);
    const known = Object.fromEntries(
      [me, ...others].map((person) => [person.userId, { ...key(), deviceId: randomUuid() }]),
    );
    const returns = returnsFor(circle, known, trustAll, me.userId);
    expect(returns).toHaveLength(MAX_RETURNS);
    expect(returns.map((given) => given.userId)).not.toContain(me.userId);

    const invited = { ...circle, members: [card(me), card(ada, 'invited')] };
    expect(returnsFor(invited, known, trustAll, me.userId)).toEqual([]);
  });
});
