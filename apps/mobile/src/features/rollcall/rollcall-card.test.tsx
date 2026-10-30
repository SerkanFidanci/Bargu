import type { Circle, MemberCard } from '@bargu/schemas';
import { fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '@/i18n';
import { useToasts } from '@/ui/toast';

import type { CheckedRollcall } from './rollcall-model';

const NOW = 1_800_000_000_000;
const OWNER = '0190f7a4-0000-7000-8000-000000000001';
const ALI = '0190f7a4-0000-7000-8000-000000000002';
const ECE = '0190f7a4-0000-7000-8000-000000000003';
const OUT = '0190f7a4-0000-7000-8000-000000000004';

const mockMe = { current: OWNER };
jest.mock('../auth/auth-store', () => ({
  useAuth: (select: (state: { userId: string }) => unknown) => select({ userId: mockMe.current }),
}));
jest.mock('../location/clock', () => ({ useNow: () => NOW }));
const mockRollcall = { current: null as CheckedRollcall | null };
const mockStart = jest.fn(() => Promise.resolve('ok'));
const mockAnswer = jest.fn(() => Promise.resolve('ok'));
const mockClose = jest.fn(() => Promise.resolve('ok'));
jest.mock('./rollcall-session', () => ({
  useRollcall: () => ({ data: mockRollcall.current }),
  startRollcall: () => mockStart(),
  answerRollcall: () => mockAnswer(),
  closeRollcall: () => mockClose(),
}));

import { RollcallCard } from './rollcall-card';

const member = (userId: string, name: string, role: 'owner' | 'member' = 'member'): MemberCard => ({
  userId,
  role,
  status: 'active',
  username: null,
  displayName: name,
  avatar: null,
  device: null,
});
const event: Circle = {
  id: '0190f7a4-0000-7000-8000-0000000000aa',
  kind: 'event',
  name: 'Gezi',
  epoch: 1,
  epochStartedAt: NOW,
  myRole: 'owner',
  myStatus: 'active',
  members: [
    member(OWNER, 'Öğretmen', 'owner'),
    member(ALI, 'Ali'),
    member(ECE, 'Ece'),
    member(OUT, 'Can'),
  ],
  expiresAt: NOW + 3_600_000,
};
const open = (here: Record<string, number> = {}): CheckedRollcall => ({
  id: '0190f7a4-0000-7000-8000-0000000000bb',
  circleId: event.id,
  startedBy: OWNER,
  startedAt: NOW - 120_000,
  closesAt: NOW + 480_000,
  closedAt: null,
  eligible: [ALI, ECE],
  outCount: 1,
  here,
});

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});
beforeEach(() => {
  jest.clearAllMocks();
  mockMe.current = OWNER;
  mockRollcall.current = null;
});

describe('"Herkes yerinde mi?" on an event (docs/ADR/0040 §5)', () => {
  it('lets an owner ask, saying it is open ten minutes and carries no location', async () => {
    await render(<RollcallCard circle={event} />);
    expect(screen.getByText(/10 dakika açık kalır. Cevapta konum yok./)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('rollcall-ask'));
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it('shows an owner who is here, who has not answered, and only how many were left out', async () => {
    mockRollcall.current = open({ [ALI]: NOW - 60_000 });
    await render(<RollcallCard circle={event} />);
    expect(screen.getByText(/1\/2 burada · 8 dk kaldı/)).toBeTruthy();
    expect(screen.getByText('Cevap vermeyenler: Ece')).toBeTruthy();
    expect(screen.getByText('Yoklamada olmayan: 1 kişi')).toBeTruthy();
    // Never who was left out: Can's name is nowhere.
    expect(screen.queryByText(/Can/)).toBeNull();
    await fireEvent.press(screen.getByTestId('rollcall-end'));
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('gives a member it asks one big "Buradayım", and then says it was said', async () => {
    mockMe.current = ALI;
    mockRollcall.current = open();
    const view = await render(<RollcallCard circle={event} />);
    expect(screen.getByText('Öğretmen soruyor: Herkes yerinde mi?')).toBeTruthy();
    expect(screen.getByText('"Buradayım" konum göndermez.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('rollcall-here'));
    expect(mockAnswer).toHaveBeenCalledTimes(1);
    await view.unmount();
    mockRollcall.current = open({ [ALI]: NOW });
    await render(<RollcallCard circle={event} />);
    expect(screen.getByTestId('rollcall-said')).toBeTruthy();
    expect(screen.queryByTestId('rollcall-here')).toBeNull();
  });

  it('shows nothing to a member it left out, nor once it is over', async () => {
    mockMe.current = OUT;
    mockRollcall.current = open();
    const view = await render(<RollcallCard circle={event} />);
    expect(screen.queryByTestId('rollcall-card')).toBeNull();
    await view.unmount();
    mockMe.current = ALI;
    mockRollcall.current = { ...open(), closesAt: NOW - 1 };
    await render(<RollcallCard circle={event} />);
    expect(screen.queryByTestId('rollcall-card')).toBeNull();
  });

  it('says why an owner could not ask', async () => {
    mockStart.mockImplementationOnce(() => Promise.resolve('RATE_LIMITED'));
    await render(<RollcallCard circle={event} />);
    await fireEvent.press(screen.getByTestId('rollcall-ask'));
    expect(useToasts.getState().current).toMatchObject({
      message: 'Bir saatte en çok 6 yoklama yapılabilir.',
    });
  });
});
