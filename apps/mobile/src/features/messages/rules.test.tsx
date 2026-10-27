import { COMMUNITY_RULES_URL, COMMUNITY_RULES_VERSION, type RulesState } from '@bargu/schemas';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Linking, Pressable, Text } from 'react-native';

import i18n from '@/i18n';

jest.mock('@/config/env', () => ({
  env: { apiUrl: 'https://api.test', mapUrl: 'https://api.test/map', appVersion: '0.0.0' },
  DEV_TOOLS_ENABLED: false,
}));
// The auth store loads the secure store; its native module is not there on Linux (CI).
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));
const mockGet = jest.fn<Promise<RulesState>, []>();
const mockAccept = jest.fn<Promise<RulesState>, []>();
jest.mock('./rules-state', () => {
  const actual = jest.requireActual<typeof import('./rules-state')>('./rules-state');
  return { ...actual, rulesApi: { get: () => mockGet(), accept: () => mockAccept() } };
});

import { useAuth } from '../auth/auth-store';
import { queryClient } from '../query-client';
import { useRulesGate } from './rules';
import { forgetRules, rulesAccepted, rulesKey } from './rules-state';

const ACCEPTED: RulesState = { rules: { version: COMMUNITY_RULES_VERSION, at: 1 } };
const action = jest.fn();

function Composer() {
  const rules = useRulesGate();
  return (
    <>
      <Pressable
        testID="send"
        onPress={() => {
          rules.ensure(action);
        }}
      >
        <Text>Gönder</Text>
      </Pressable>
      {rules.sheet}
    </>
  );
}

const show = () =>
  render(
    <QueryClientProvider client={queryClient}>
      <Composer />
    </QueryClientProvider>,
  );

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});
afterAll(() => {
  queryClient.clear();
});
beforeEach(() => {
  jest.clearAllMocks();
  queryClient.clear();
  useAuth.setState({ userId: '0190f7a4-1111-7111-8111-000000000001' });
});

describe('the community rules (K14)', () => {
  it('come before the first message: nothing goes until "Kabul ediyorum", then it does', async () => {
    mockGet.mockResolvedValue({ rules: null });
    mockAccept.mockResolvedValue(ACCEPTED);
    await show();
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: rulesKey });
    });
    await fireEvent.press(screen.getByTestId('send'));
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByText(/24 saatte silinir/)).toBeTruthy();
    expect(screen.getByText('• taciz ve tehdit')).toBeTruthy();

    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await fireEvent.press(screen.getByTestId('rules-full'));
    expect(open).toHaveBeenCalledWith(COMMUNITY_RULES_URL);
    expect(action).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('rules-accept'));
    expect(mockAccept).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledTimes(1);
    expect(rulesAccepted(queryClient.getQueryData(rulesKey))).toBe(true);

    // Accepted once: the next message goes at once.
    await fireEvent.press(screen.getByTestId('send'));
    expect(action).toHaveBeenCalledTimes(2);
    expect(mockAccept).toHaveBeenCalledTimes(1);
  });

  it('ask again when the server has no record of them, or an older version', async () => {
    mockGet.mockResolvedValue(ACCEPTED);
    await show();
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: rulesKey });
    });
    await fireEvent.press(screen.getByTestId('send'));
    expect(action).toHaveBeenCalledTimes(1);
    // The cache tells the screen on its next tick.
    await act(async () => {
      forgetRules();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await fireEvent.press(screen.getByTestId('send'));
    expect(action).toHaveBeenCalledTimes(1);
    expect(rulesAccepted({ rules: { version: COMMUNITY_RULES_VERSION - 1, at: 1 } })).toBe(false);
  });

  it('say so when accepting fails, and send nothing', async () => {
    mockGet.mockResolvedValue({ rules: null });
    mockAccept.mockRejectedValue(new Error('offline'));
    await show();
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: rulesKey });
    });
    await fireEvent.press(screen.getByTestId('send'));
    await fireEvent.press(screen.getByTestId('rules-accept'));
    expect(action).not.toHaveBeenCalled();
    expect(rulesAccepted(queryClient.getQueryData(rulesKey))).toBe(false);
  });
});
