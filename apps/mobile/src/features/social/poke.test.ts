import type { MessageEnvelope, PokePayload } from '@bargu/schemas';

import { circlesKey } from '../circles/circle-cache';
import { createReceiver } from '../location/receive';
import { circleOf, exchangeKeys, memoryStore, somebody } from '../location/test-support';
import { queryClient } from '../query-client';

// Who this phone is, and what it sends: the request is kept, the server says it went.
const mockAuth: { device: unknown; userId: string | null } = { device: null, userId: null };
const mockSent: {
  body: { envelope: MessageEnvelope; pushes: { userId: string; sealed: string }[] };
}[] = [];
jest.mock('../auth/auth-store', () => ({
  api: {
    authed: (_path: string, init: { body: never }) => {
      mockSent.push({ body: init.body });
      return Promise.resolve({ ok: true });
    },
  },
  onSignedOut: jest.fn(),
  useAuth: { getState: () => mockAuth },
}));
const mockKeys: { current: unknown } = { current: null };
jest.mock('../live/live-session', () => ({
  keys: () => mockKeys.current,
  liveRequest: () => null,
}));
// Each member's phone in the circle, and what this phone seals for it (the body, readable here).
const mockRecipients: { userId: string; deviceId: string; dhKey: string }[] = [];
jest.mock('../notifications/push-contacts', () => ({
  contactsOf: (circles: { id: string }[]) => ({
    recipients: Object.fromEntries(circles.map((circle) => [circle.id, mockRecipients])),
  }),
}));
jest.mock('../places/presence', () => ({
  sealPushes: (
    recipients: { userId: string; deviceId: string }[],
    _device: unknown,
    body: unknown,
  ) => recipients.map((recipient) => ({ ...recipient, sealed: JSON.stringify(body) })),
}));

import { pokeWith, receiveStyledPoke, showPoke, usePokeShow } from './poke';

const [ayse, bora, can] = [somebody(), somebody(), somebody()];
const circle = circleOf([ayse, bora, can]);
exchangeKeys(circle, [ayse, bora, can]);

beforeEach(() => {
  mockSent.splice(0, mockSent.length);
  mockAuth.device = ayse.device;
  mockAuth.userId = ayse.userId;
  mockKeys.current = ayse.keys;
  mockRecipients.splice(0, mockRecipients.length);
  for (const person of [bora, can]) {
    mockRecipients.push({ userId: person.userId, deviceId: person.device.deviceId, dhKey: 'x' });
  }
  queryClient.setQueryData(circlesKey, [circle]);
  usePokeShow.setState(null, true);
});

describe('a poke with a feeling or a question (docs/ADR/0031)', () => {
  it('names whom it is for; only their phone gets the notification', async () => {
    expect(await pokeWith(circle.id, bora.userId, 'kiss')).toBe('sent');
    const sent = mockSent[0]?.body;
    expect(sent?.pushes.map((push) => push.userId)).toEqual([bora.userId]);
    expect(JSON.parse(sent?.pushes[0]?.sealed ?? '{}')).toMatchObject({
      kind: 'poke',
      circleId: circle.id,
      style: 'kiss',
    });
    // The message reaches the circle; each phone reads whom it is for.
    const heard: PokePayload[] = [];
    const receiver = createReceiver({
      keys: () => bora.keys,
      circles: () => [circle],
      store: () => memoryStore(),
      onPoke: (_circleId, _userId, poke) => heard.push(poke),
    });
    if (sent !== undefined) receiver.receive(sent.envelope, 'bump');
    expect(heard).toEqual([expect.objectContaining({ to: bora.userId, style: 'kiss' })]);
  });

  it('is never sent to someone outside the circle', async () => {
    expect(await pokeWith(circle.id, somebody().userId, 'hug')).toBe('failed');
    expect(mockSent).toEqual([]);
  });

  it('plays only on the phone it is for, fresh, and once even when it comes twice', () => {
    const now = Date.now();
    const kiss: PokePayload = { kind: 'poke', to: bora.userId, style: 'kiss', ts: now };
    expect(receiveStyledPoke(circle.id, ayse.userId, kiss, can.userId, now)).toBeNull();
    expect(receiveStyledPoke(circle.id, ayse.userId, kiss, bora.userId, now + 61_000)).toBeNull();
    const shown = receiveStyledPoke(circle.id, ayse.userId, kiss, bora.userId, now);
    expect(shown).toMatchObject({ userId: ayse.userId, name: 'Test', style: 'kiss' });
    if (shown === null) return;
    showPoke(shown, kiss.ts);
    const first = usePokeShow.getState();
    expect(first).toMatchObject({ style: 'kiss' });
    usePokeShow.setState(null, true);
    // The same poke again (the socket and the notification): nothing plays.
    showPoke(shown, kiss.ts);
    expect(usePokeShow.getState()).toBeNull();
  });
});
