import { issueCosmeticPass } from '@bargu/crypto';
import type { Circle, CosmeticPass, MessageEnvelope, Plan } from '@bargu/schemas';

import { ApiError } from '../auth/api-client';
import { planKey } from '../billing/plan';
import { circlesKey } from '../circles/circle-cache';
import { createReceiver } from '../location/receive';
import { card, circleOf, exchangeKeys, nth, type Person, somebody } from '../location/test-support';
import { queryClient } from '../query-client';
import {
  chooseLook,
  forgetLookOf,
  publishLook,
  receivedLook,
  refreshPass,
  resetLooks,
  restoreLooks,
  useLooks,
  useMyLook,
} from './look-session';

// The phone the module's singletons act as (its keys, its vault, its account), switched by a test.
let mockPhone: Person;
// What the server's pass endpoint answers, and every call made to the server.
let mockGivenPass: CosmeticPass | null = null;
let mockPassRefused = false;
const mockAuthed = jest.fn<
  Promise<unknown>,
  [string, { body?: { envelopes: MessageEnvelope[] } }?]
>((path, options) => {
  if (path === '/v1/me/cosmetics/pass') {
    return mockPassRefused
      ? Promise.reject(new ApiError(404, 'NOT_FOUND'))
      : Promise.resolve({ pass: mockGivenPass });
  }
  mockSent.push(...(options?.body?.envelopes ?? []));
  return Promise.resolve({ accepted: options?.body?.envelopes.length ?? 0, refused: [] });
});
const mockSent: MessageEnvelope[] = [];

jest.mock('../auth/auth-store', () => ({
  api: { authed: (path: string, options?: never) => mockAuthed(path, options) },
  useAuth: { getState: () => ({ userId: mockPhone.userId, device: mockPhone.device }) },
  onSignedOut: jest.fn(),
}));
jest.mock('../live/live-session', () => ({
  keys: () => mockPhone.keys,
  // No socket: the look goes over HTTP (POST /v1/looks), which the test double above records.
  liveRequest: () => null,
}));
jest.mock('../storage/vault', () => ({ isVaultOpen: () => true, vault: () => mockPhone.store }));
// The staging server's signing key: seven, thirty-two times (the test signs with it below).
jest.mock('./trusted-keys', () => {
  const crypto = jest.requireActual<typeof import('@bargu/crypto')>('@bargu/crypto');
  return {
    trustedKeys: crypto.parseCosmeticKeys(
      `stg-1:${crypto.cosmeticPublicKey(new Uint8Array(32).fill(7))}`,
    ),
  };
});

const DAY = 24 * 3600_000;
const STAGING = new Uint8Array(32).fill(7);
const STRANGER = new Uint8Array(32).fill(9);

function passFor(
  person: Person,
  packs: string[],
  overrides: Partial<Parameters<typeof issueCosmeticPass>[0]> = {},
): CosmeticPass {
  const now = Date.now();
  return issueCosmeticPass({
    secretKey: STAGING,
    kid: 'stg-1',
    userId: person.userId,
    packs,
    issuedAt: now,
    expiresAt: now + 30 * DAY,
    ...overrides,
  });
}

const plan = (cosmetics: string[]): Plan => ({
  plan: 'free',
  product: null,
  source: null,
  expiresAt: null,
  autoRenew: false,
  graceUntil: null,
  trialEndsAt: null,
  cosmetics,
  testBilling: true,
});

let me: Person;
let friend: Person;
let circle: Circle;

/** The circle list as the app caches it, and what this phone has seen of it. */
function setCircles(...circles: Circle[]): void {
  queryClient.setQueryData(circlesKey, circles);
  for (const each of circles) mockPhone.keys.observe(each);
}
function passAt(path: string): number {
  return mockAuthed.mock.calls.filter(([called]) => called === path).length;
}

beforeEach(() => {
  me = somebody();
  friend = somebody();
  mockPhone = me;
  mockGivenPass = null;
  mockPassRefused = false;
  mockSent.length = 0;
  mockAuthed.mockClear();
  queryClient.clear();
  resetLooks();
  circle = circleOf([me, friend]);
  exchangeKeys(circle, [me, friend]);
  setCircles(circle);
});

afterAll(() => {
  // The cache's garbage collection timers would keep the test process open.
  queryClient.clear();
});

describe('telling circles the look, wherever the profile goes (docs/ADR/0025 §3)', () => {
  it('sends it once, and again for a new epoch, a new member, a new phone and trust given later', async () => {
    mockGivenPass = passFor(me, ['rings', 'frames']);
    await refreshPass();
    await chooseLook({ ring: 'stripes', frame: null });
    expect(mockSent).toHaveLength(1);
    expect(nth(mockSent).circleId).toBe(circle.id);
    // Nothing changed: nothing sent.
    await publishLook();
    expect(mockSent).toHaveLength(1);
    // A new epoch (the circle's keys were rotated).
    const next: Circle = { ...circle, epoch: 2 };
    setCircles(next);
    await publishLook();
    expect(mockSent).toHaveLength(2);
    // A new member, who could not read the look sent before.
    const third = somebody();
    const grown: Circle = { ...next, members: [...next.members, card(third)] };
    setCircles(grown);
    await publishLook();
    expect(mockSent).toHaveLength(3);
    // The friend's new phone: its key changed, so nothing goes to it until the user accepts…
    const newPhone = card(somebody());
    const changed: Circle = {
      ...grown,
      members: grown.members.map((member) =>
        member.userId === friend.userId ? { ...member, device: newPhone.device } : member,
      ),
    };
    setCircles(changed);
    await publishLook();
    expect(mockSent).toHaveLength(4);
    // …and once the user accepts (trust on first use), the look is due to the new phone.
    me.keys.acknowledgeChange(friend.userId);
    await publishLook();
    expect(mockSent).toHaveLength(5);
    await publishLook();
    expect(mockSent).toHaveLength(5);
  });

  it('says nothing of a plain look to a circle that never heard of a look, and the plain one once after', async () => {
    mockGivenPass = passFor(me, ['rings', 'frames']);
    await refreshPass();
    await publishLook();
    expect(mockSent).toHaveLength(0);
    await chooseLook({ ring: 'dots', frame: 'gold' });
    expect(mockSent).toHaveLength(1);
    // Back to plain: the circles are told, so the old look goes from their maps.
    await chooseLook({ ring: null, frame: null });
    expect(mockSent).toHaveLength(2);
    await publishLook();
    expect(mockSent).toHaveLength(2);
  });

  it('sends nothing where nobody else is', async () => {
    const alone = circleOf([me]);
    queryClient.setQueryData(circlesKey, [alone]);
    mockGivenPass = passFor(me, ['rings']);
    await refreshPass();
    await chooseLook({ ring: 'dots', frame: null });
    expect(mockSent).toHaveLength(0);
  });

  it('is one run when called twice at once', async () => {
    mockGivenPass = passFor(me, ['rings']);
    await refreshPass();
    await Promise.all([chooseLook({ ring: 'dots', frame: null }), publishLook(), publishLook()]);
    expect(mockSent).toHaveLength(1);
  });

  it('keeps the choice and the pass across a restart, and shows the own look at once', async () => {
    mockGivenPass = passFor(me, ['rings']);
    await refreshPass();
    await chooseLook({ ring: 'sparkle', frame: null });
    expect(useMyLook.getState().look).toMatchObject({ ring: 'sparkle' });
    resetLooks();
    expect(useMyLook.getState().look).toBeNull();
    restoreLooks();
    expect(useMyLook.getState().choice).toEqual({ ring: 'sparkle', frame: null });
    expect(useMyLook.getState().look).toMatchObject({ ring: 'sparkle' });
  });

  it('shows the user no look from a pass this build does not trust', async () => {
    mockGivenPass = passFor(me, ['rings'], { secretKey: STRANGER });
    await refreshPass();
    await chooseLook({ ring: 'sparkle', frame: null });
    expect(useMyLook.getState().look).toBeNull();
  });
});

describe('the own pass (docs/ADR/0025 §1)', () => {
  it('is asked for when there is none, and kept', async () => {
    mockGivenPass = passFor(me, ['rings']);
    await refreshPass();
    expect(passAt('/v1/me/cosmetics/pass')).toBe(1);
    expect(useMyLook.getState().pass).toEqual(mockGivenPass);
  });

  it('is not asked for again while more than half of it is left', async () => {
    mockGivenPass = passFor(me, ['rings']);
    await refreshPass();
    await refreshPass();
    expect(passAt('/v1/me/cosmetics/pass')).toBe(1);
  });

  it('is asked for again with less than half left, when forced, or when the plan has a pack it lacks', async () => {
    const old = passFor(me, ['rings'], {
      issuedAt: Date.now() - 20 * DAY,
      expiresAt: Date.now() + 10 * DAY,
    });
    me.store.set('look:pass:v1', JSON.stringify(old));
    restoreLooks();
    mockGivenPass = passFor(me, ['rings']);
    await refreshPass();
    expect(passAt('/v1/me/cosmetics/pass')).toBe(1);
    expect(useMyLook.getState().pass).toEqual(mockGivenPass);
    // Fresh now: only force, or a pack in the plan the pass lacks, asks again.
    await refreshPass();
    expect(passAt('/v1/me/cosmetics/pass')).toBe(1);
    queryClient.setQueryData(planKey, plan(['rings']));
    await refreshPass();
    expect(passAt('/v1/me/cosmetics/pass')).toBe(1);
    queryClient.setQueryData(planKey, plan(['rings', 'frames']));
    mockGivenPass = passFor(me, ['frames', 'rings']);
    await refreshPass();
    expect(passAt('/v1/me/cosmetics/pass')).toBe(2);
    await refreshPass(true);
    expect(passAt('/v1/me/cosmetics/pass')).toBe(3);
  });

  it('is one request when asked for twice at once', async () => {
    mockGivenPass = passFor(me, ['rings']);
    await Promise.all([refreshPass(), refreshPass()]);
    expect(passAt('/v1/me/cosmetics/pass')).toBe(1);
  });

  it('goes when the server no longer gives one (a refund), and the plain look is told', async () => {
    mockGivenPass = passFor(me, ['rings']);
    await refreshPass();
    await chooseLook({ ring: 'dots', frame: null });
    expect(mockSent).toHaveLength(1);
    mockGivenPass = null;
    await refreshPass(true);
    expect(useMyLook.getState().pass).toBeNull();
    expect(useMyLook.getState().look).toBeNull();
    // The circle still hears the choice but with no pass: friends show the plain look.
    expect(mockSent).toHaveLength(2);
  });

  it('is simply none on a server without a signing key', async () => {
    mockPassRefused = true;
    await expect(refreshPass()).resolves.toBeUndefined();
    expect(passAt('/v1/me/cosmetics/pass')).toBe(1);
    expect(useMyLook.getState().pass).toBeNull();
  });
});

describe('a look from a friend, from one phone to another (docs/ADR/0025 §3)', () => {
  /** The friend publishes a look as their phone would; this phone opens it as the receiver. */
  async function arrives(
    pass: CosmeticPass | null,
    choice: { ring: string | null; frame: string | null },
  ): Promise<Record<string, unknown>> {
    mockPhone = friend;
    resetLooks();
    mockGivenPass = pass;
    await refreshPass(true);
    setCircles(circle);
    await chooseLook(choice);
    // The last one: a new pass may have sent the phone's earlier choice just before.
    const envelope = nth(mockSent, mockSent.length - 1);
    mockSent.length = 0;
    mockPhone = me;
    resetLooks();
    const receiver = createReceiver({
      keys: () => me.keys,
      circles: () => [circle],
      store: () => me.store,
      onLook: (userId, look) => {
        receivedLook(userId, look);
      },
    });
    expect(receiver.receive(envelope)).toBe('shown');
    return useLooks.getState();
  }

  it('shows when the pass holds: a trusted key, theirs, in time, naming the pack', async () => {
    const seen = await arrives(passFor(friend, ['rings', 'frames']), {
      ring: 'stripes',
      frame: 'neon',
    });
    expect(seen[friend.userId]).toMatchObject({ ring: 'stripes', frame: 'neon' });
  });

  it('shows the plain look for a pass signed by a key no build trusts', async () => {
    const seen = await arrives(passFor(friend, ['rings'], { secretKey: STRANGER }), {
      ring: 'stripes',
      frame: null,
    });
    expect(seen[friend.userId]).toBeUndefined();
  });

  it('shows the plain look for a key id this build does not know', async () => {
    const seen = await arrives(passFor(friend, ['rings'], { kid: 'stg-2' }), {
      ring: 'stripes',
      frame: null,
    });
    expect(seen[friend.userId]).toBeUndefined();
  });

  it('shows the plain look once the pass has expired', async () => {
    const seen = await arrives(
      passFor(friend, ['rings'], { issuedAt: Date.now() - 40 * DAY, expiresAt: Date.now() - DAY }),
      { ring: 'stripes', frame: null },
    );
    expect(seen[friend.userId]).toBeUndefined();
  });

  it("shows the plain look for another account's pass (one copied from somebody else)", async () => {
    const seen = await arrives(passFor(me, ['rings', 'frames']), {
      ring: 'stripes',
      frame: 'neon',
    });
    expect(seen[friend.userId]).toBeUndefined();
  });

  it('shows only the styles whose pack the pass names, else the default look', async () => {
    const half = await arrives(passFor(friend, ['rings']), { ring: 'dots', frame: 'gold' });
    expect(half[friend.userId]).toMatchObject({ ring: 'dots' });
    expect((half[friend.userId] as { frame?: string }).frame).toBeUndefined();
    const none = await arrives(passFor(friend, ['rings']), { ring: null, frame: 'gold' });
    expect(none[friend.userId]).toBeUndefined();
  });

  it('shows the plain look for a message without a pass', async () => {
    const seen = await arrives(null, { ring: 'dots', frame: 'gold' });
    expect(seen[friend.userId]).toBeUndefined();
  });
});

describe('looks received, kept and replaced', () => {
  const NOW = Date.now();
  const look = (pass: CosmeticPass | null, ring: string | null, ts: number) =>
    ({ kind: 'look', ring, frame: null, pass, ts }) as const;

  it('keeps the newest message of a member, a plain one too', () => {
    const pass = passFor(friend, ['rings']);
    receivedLook(friend.userId, look(pass, 'dots', 20), NOW);
    expect(useLooks.getState()[friend.userId]).toMatchObject({ ring: 'dots', ts: 20 });
    // An older message that came late changes nothing…
    receivedLook(friend.userId, look(pass, 'stripes', 10), NOW);
    expect(useLooks.getState()[friend.userId]).toMatchObject({ ring: 'dots' });
    // …a newer plain one takes the look off…
    receivedLook(friend.userId, look(null, null, 30), NOW);
    expect(useLooks.getState()[friend.userId]).toBeUndefined();
    // …and an older look after it does not bring it back.
    receivedLook(friend.userId, look(pass, 'stripes', 25), NOW);
    expect(useLooks.getState()[friend.userId]).toBeUndefined();
  });

  it('shows again after a restart (checked again), but not once the pass has run out', () => {
    const pass = passFor(friend, ['rings'], { issuedAt: NOW, expiresAt: NOW + 10 * DAY });
    receivedLook(friend.userId, look(pass, 'sparkle', 20), NOW);
    resetLooks();
    expect(useLooks.getState()[friend.userId]).toBeUndefined();
    restoreLooks(NOW + DAY);
    expect(useLooks.getState()[friend.userId]).toMatchObject({ ring: 'sparkle' });
    resetLooks();
    restoreLooks(NOW + 11 * DAY);
    expect(useLooks.getState()[friend.userId]).toBeUndefined();
  });

  it('forgets a person no circle is shared with any more: the look, its copy in the vault and the memory of their newest message', () => {
    const pass = passFor(friend, ['rings']);
    receivedLook(friend.userId, look(pass, 'dots', 20), NOW);
    expect(mockPhone.store.get('look:others:v1')).toContain(friend.userId);

    forgetLookOf(friend.userId);
    expect(useLooks.getState()[friend.userId]).toBeUndefined();
    expect(mockPhone.store.get('look:others:v1') ?? '').not.toContain(friend.userId);
    // Not even after a restart…
    resetLooks();
    restoreLooks(NOW);
    expect(useLooks.getState()[friend.userId]).toBeUndefined();
    // …and an older message is a message like any other when they are met again (nothing is
    // remembered of what came before).
    receivedLook(friend.userId, look(pass, 'stripes', 10), NOW);
    expect(useLooks.getState()[friend.userId]).toMatchObject({ ring: 'stripes', ts: 10 });
  });

  it('does not lose what was kept, nor let it replace a look that came since', () => {
    const other = somebody();
    receivedLook(other.userId, look(passFor(other, ['rings']), 'gradient', 20), NOW);
    const pass = passFor(friend, ['rings']);
    receivedLook(friend.userId, look(pass, 'dots', 20), NOW);
    resetLooks();
    // The relay's snapshot may come before the app's own restore: the kept ones come back first,
    // and a kept look older than the one that came stays behind it.
    receivedLook(friend.userId, look(pass, 'stripes', 30), NOW);
    restoreLooks(NOW);
    expect(useLooks.getState()[friend.userId]).toMatchObject({ ring: 'stripes', ts: 30 });
    expect(useLooks.getState()[other.userId]).toMatchObject({ ring: 'gradient', ts: 20 });
  });
});
