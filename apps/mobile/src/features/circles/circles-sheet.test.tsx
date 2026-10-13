import type { Circle, MemberCard } from '@bargu/schemas';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '@/i18n';

import { CirclesSheet } from './circles-sheet';

const mockMe = '0190a8a0-0000-7000-8000-000000000001';
const mockList = jest.fn<Promise<Circle[]>, []>();
const mockAccept = jest.fn<Promise<Circle>, [string]>();
const mockPush = jest.fn();

jest.mock('../auth/auth-store', () => ({
  useAuth: (select: (state: { status: string; userId: string }) => unknown) =>
    select({ status: 'signedIn', userId: mockMe }),
}));
jest.mock('./circles-api', () => ({
  circlesApi: {
    list: () => mockList(),
    accept: (id: string) => mockAccept(id),
  },
}));
jest.mock('../live/live-session', () => ({
  circleSync: { adopt: () => Promise.resolve(), drop: () => undefined },
}));
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) as unknown },
}));

function member(userId: string, name: string, status: MemberCard['status']): MemberCard {
  return {
    userId,
    role: 'owner',
    status,
    username: name.toLowerCase(),
    displayName: name,
    avatar: null,
    device: null,
  };
}

function pair(id: string, other: MemberCard, myStatus: Circle['myStatus']): Circle {
  return {
    id,
    kind: 'pair',
    name: null,
    epoch: 2,
    epochStartedAt: 0,
    myRole: 'owner',
    myStatus,
    members: [member(mockMe, 'Ben', myStatus), other],
  };
}

const REQUEST = '0190a8a0-0000-7000-8000-0000000000a1';
const SENT = '0190a8a0-0000-7000-8000-0000000000a2';

async function renderSheet() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
  await render(
    <QueryClientProvider client={queryClient}>
      <CirclesSheet ref={null} onAdd={jest.fn()} onClose={jest.fn()} />
    </QueryClientProvider>,
  );
}

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});

describe('CirclesSheet', () => {
  it('puts requests first, with accept right in the row, and shows sent requests as pending', async () => {
    const incoming = pair(
      REQUEST,
      member('0190a8a0-0000-7000-8000-0000000000b1', 'Ali', 'active'),
      'invited',
    );
    const outgoing = pair(
      SENT,
      member('0190a8a0-0000-7000-8000-0000000000b2', 'Veli', 'invited'),
      'active',
    );
    mockList.mockResolvedValue([incoming, outgoing]);
    mockAccept.mockResolvedValue({ ...incoming, myStatus: 'active' });
    await renderSheet();

    expect(await screen.findByText('İstekler')).toBeTruthy();
    expect(screen.getByText('Ali')).toBeTruthy();
    expect(screen.getByText('Seni arkadaş olarak eklemek istiyor')).toBeTruthy();
    expect(screen.getByText('Bekliyor')).toBeTruthy();

    await act(async () => {
      await fireEvent.press(screen.getByLabelText('Kabul et'));
      await Promise.resolve();
    });
    expect(mockAccept).toHaveBeenCalledWith(REQUEST);
  });

  it('opens a friend’s screen from the list', async () => {
    const friend = pair(
      SENT,
      member('0190a8a0-0000-7000-8000-0000000000b3', 'Can', 'active'),
      'active',
    );
    mockList.mockResolvedValue([friend]);
    await renderSheet();
    await fireEvent.press(await screen.findByLabelText('Can, @can'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/circle/[id]', params: { id: SENT } });
  });

  it('invites to add a friend when there is nobody yet', async () => {
    mockList.mockResolvedValue([]);
    await renderSheet();
    expect(await screen.findByText('Henüz çemberin yok')).toBeTruthy();
  });
});
