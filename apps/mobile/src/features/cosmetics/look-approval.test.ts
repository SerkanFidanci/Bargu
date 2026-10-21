import type { Plan } from '@bargu/schemas';

import i18n from '@/i18n';
import { useToasts } from '@/ui/toast';

const mockRefresh = jest.fn<Promise<void>, [boolean | undefined]>();
const mockChoose = jest.fn<Promise<void>, [{ ring: string | null; frame: string | null }]>();
let mockChoice: { ring: string | null; frame: string | null } = { ring: null, frame: null };
// The choice, the pass and the sending to circles live in look-session.test.ts.
jest.mock('./look-session', () => ({
  refreshPass: (force?: boolean) => mockRefresh(force),
  chooseLook: (choice: { ring: string | null; frame: string | null }) => mockChoose(choice),
  useMyLook: { getState: () => ({ choice: mockChoice }) },
}));

import { approvedPacks, planSeen, resetApproval } from './look-approval';
import { resetTrying, stopTrying, tryStyle, useTrying } from './look-trying';

const plan = (cosmetics: string[], pendingCosmetics?: string[]): Plan => ({
  plan: 'free',
  product: null,
  source: null,
  expiresAt: null,
  autoRenew: false,
  graceUntil: null,
  trialEndsAt: null,
  cosmetics,
  testBilling: true,
  ...(pendingCosmetics === undefined ? {} : { pendingCosmetics }),
});

/** The work after a plan arrived is async (the pass, then the choice): let it finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});
beforeEach(async () => {
  jest.clearAllMocks();
  mockChoice = { ring: null, frame: null };
  mockRefresh.mockImplementation(() => Promise.resolve());
  mockChoose.mockImplementation(() => Promise.resolve());
  useToasts.setState({ current: null });
  resetApproval();
  resetTrying();
  await i18n.changeLanguage('tr');
});

describe('approvedPacks: a pack a parent said yes to', () => {
  it('is a pack the plan before had waiting and this plan has', () => {
    expect(approvedPacks(plan([], ['rings']), plan(['rings'], []))).toEqual(['rings']);
    expect(approvedPacks(plan([], ['rings', 'frames']), plan(['frames', 'rings']))).toEqual([
      'rings',
      'frames',
    ]);
  });

  it('is nothing for a pack bought at once, a no, a plan without the field or the first plan seen', () => {
    // An adult's purchase never waited.
    expect(approvedPacks(plan([]), plan(['rings']))).toEqual([]);
    // A no: it stops waiting without becoming theirs.
    expect(approvedPacks(plan([], ['rings']), plan([], []))).toEqual([]);
    // Still waiting; or waiting for the other pack.
    expect(approvedPacks(plan([], ['rings']), plan([], ['rings']))).toEqual([]);
    expect(approvedPacks(plan([], ['frames']), plan(['rings'], ['frames']))).toEqual([]);
    // Nothing seen before, or a server that does not say what waits.
    expect(approvedPacks(undefined, plan(['rings']))).toEqual([]);
    expect(approvedPacks(plan([]), plan(['rings'], []))).toEqual([]);
  });

  it('leaves out a pack this app does not know', () => {
    expect(approvedPacks(plan([], ['seasonal_7']), plan(['seasonal_7']))).toEqual([]);
  });
});

describe('a parent says yes while the teen waits (docs/ADR/0025, slice 3c)', () => {
  it('says so, and chooses and sends the style that was tried, keeping the other part', async () => {
    mockChoice = { ring: 'dots', frame: null };
    tryStyle('frame', 'gold');
    planSeen(plan([], ['frames']));
    expect(mockChoose).not.toHaveBeenCalled();
    // The plan.changed brought the pack.
    planSeen(plan(['frames'], []));
    expect(useToasts.getState().current).toMatchObject({
      message: 'Ebeveynin onayladı: Pin çerçeveleri',
      tone: 'success',
    });
    await settle();
    expect(mockRefresh).toHaveBeenCalledWith(true);
    expect(mockChoose).toHaveBeenCalledTimes(1);
    expect(mockChoose).toHaveBeenCalledWith({ ring: 'dots', frame: 'gold' });
    // What was tried is no trial any more.
    expect(useTrying.getState().frame).toBeUndefined();
  });

  it('words the notice in English too, by the pack asked for', async () => {
    await i18n.changeLanguage('en');
    tryStyle('ring', 'sparkle');
    planSeen(plan([], ['rings']));
    planSeen(plan(['rings']));
    expect(useToasts.getState().current?.message).toBe('Your parent said yes: Ring patterns');
    await settle();
    expect(mockChoose).toHaveBeenCalledWith({ ring: 'sparkle', frame: null });
  });

  it('only says so when nothing was tried, and when only the plain one was', async () => {
    planSeen(plan([], ['rings', 'frames']));
    tryStyle('frame', null);
    planSeen(plan(['rings', 'frames'], []));
    await settle();
    expect(useToasts.getState().current?.message).toBe('Ebeveynin onayladı: Pin çerçeveleri');
    expect(mockRefresh).toHaveBeenCalledTimes(2);
    expect(mockChoose).not.toHaveBeenCalled();
  });

  it('handles each pack with its own tried style', async () => {
    tryStyle('ring', 'stripes');
    tryStyle('frame', 'neon');
    planSeen(plan([], ['rings', 'frames']));
    planSeen(plan(['rings', 'frames']));
    await settle();
    expect(mockChoose).toHaveBeenCalledTimes(2);
    expect(mockChoose).toHaveBeenCalledWith({ ring: 'stripes', frame: null });
    expect(mockChoose).toHaveBeenCalledWith({ ring: null, frame: 'neon' });
  });

  it('keeps the choice when the pass cannot be had now', async () => {
    mockRefresh.mockRejectedValue(new Error('offline'));
    tryStyle('ring', 'gradient');
    planSeen(plan([], ['rings']));
    planSeen(plan(['rings']));
    await settle();
    expect(mockChoose).toHaveBeenCalledWith({ ring: 'gradient', frame: null });
  });

  it('does it once, however often the same plan is seen again', async () => {
    tryStyle('ring', 'dots');
    planSeen(plan([], ['rings']));
    planSeen(plan(['rings'], []));
    planSeen(plan(['rings'], []));
    planSeen(plan(['rings']));
    await settle();
    expect(mockChoose).toHaveBeenCalledTimes(1);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a pack bought at once, or when the parent says no', async () => {
    tryStyle('ring', 'dots');
    // An adult's (or a test) purchase: it never waited.
    planSeen(plan([]));
    planSeen(plan(['rings']));
    await settle();
    expect(mockChoose).not.toHaveBeenCalled();
    expect(useToasts.getState().current).toBeNull();

    // A no: no notice, no choice, and the style stays tried (the user may ask again).
    tryStyle('frame', 'holo');
    planSeen(plan(['rings'], ['frames']));
    planSeen(plan(['rings'], []));
    await settle();
    expect(mockChoose).not.toHaveBeenCalled();
    expect(useToasts.getState().current).toBeNull();
    expect(useTrying.getState().frame).toBe('holo');
  });

  it('forgets the plan before when the account signs out', async () => {
    tryStyle('ring', 'dots');
    planSeen(plan([], ['rings']));
    resetApproval();
    resetTrying();
    // The next account's first plan is compared with nothing.
    planSeen(plan(['rings']));
    await settle();
    expect(mockChoose).not.toHaveBeenCalled();
    expect(useToasts.getState().current).toBeNull();
  });

  it('does not choose a style tried once it was taken back', async () => {
    tryStyle('ring', 'dots');
    stopTrying('ring');
    planSeen(plan([], ['rings']));
    planSeen(plan(['rings']));
    await settle();
    expect(mockChoose).not.toHaveBeenCalled();
    expect(useToasts.getState().current?.message).toBe('Ebeveynin onayladı: Halka desenleri');
  });
});
