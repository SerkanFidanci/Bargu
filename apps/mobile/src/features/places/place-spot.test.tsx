import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import type { Ref } from 'react';

import i18n from '@/i18n';

jest.mock('@/config/env', () => ({
  env: { apiUrl: 'https://api.test', mapUrl: 'https://api.test/map', appVersion: '0.0.0' },
  DEV_TOOLS_ENABLED: false,
}));
const CIRCLE = '0190f7a4-5b6c-7d8e-9f01-23456789abcd';
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({ circleId: CIRCLE, forMeeting: '1' }),
}));
// The map: a stand-in that names the point it settles on as the map's labels would.
const mockMap: {
  onSettle?: ((view: { center: [number, number]; zoom: number }) => void) | undefined;
} = {};
jest.mock('@/features/map/bargu-map', () => {
  const { useImperativeHandle } = jest.requireActual<typeof import('react')>('react');
  return {
    BarguMap: (props: {
      ref?: Ref<unknown>;
      onSettle?: (view: { center: [number, number]; zoom: number }) => void;
    }) => {
      useImperativeHandle(props.ref, () => ({ placeName: () => Promise.resolve('Taksim') }));
      mockMap.onSettle = props.onSettle;
      return null;
    },
  };
});
jest.mock('@/features/places/place-editor', () => ({
  PlaceCircle: () => null,
  useEditorView: () => ({ view: null, onViewChange: () => undefined }),
}));
jest.mock('@/features/location/engine', () => ({
  useMyFix: (select: (state: { fix: null }) => unknown) => select({ fix: null }),
}));
jest.mock('@/features/notifications/mute-session', () => ({
  loadMuteSettings: () => undefined,
  updateMutes: jest.fn(),
}));
jest.mock('@/features/notifications/mutes', () => ({
  useMutes: () => ({ places: {} }),
  withPlaceMuted: jest.fn(),
}));
const mockSave = jest.fn<Promise<'saved'>, [string, Record<string, unknown>]>(() =>
  Promise.resolve('saved'),
);
jest.mock('@/features/places/places-session', () => ({
  places: {
    save: (circleId: string, place: Record<string, unknown>) => mockSave(circleId, place),
    remove: jest.fn(),
  },
}));
// The vault (MMKV, native): a map here. It keeps the spots this phone added (QA-35).
const mockVault = new Map<string, string>();
jest.mock('@/features/storage/vault', () => ({
  isVaultOpen: () => true,
  vault: () => ({
    get: (key: string) => mockVault.get(key),
    set: (key: string, value: string) => {
      mockVault.set(key, value);
    },
  }),
}));
jest.mock('@/ui/toast', () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

import PlaceEditor from '@/app/(app)/place/[circleId]';
import { useMeetingPlaceDraft } from '@/features/plan/meeting-place';
import { toast } from '@/ui/toast';

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});
beforeEach(() => {
  jest.clearAllMocks();
  mockVault.clear();
  useMeetingPlaceDraft.setState(null, true);
});

describe('a meeting spot picked on the map (the owner, 2026-10-23)', () => {
  it('asks only for the point: no size, no icon, and the name is optional', async () => {
    await render(<PlaceEditor />);
    expect(screen.getByText('Buluşma noktası')).toBeTruthy();
    expect(screen.getByText('Ad (isteğe bağlı)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '🏠' })).toBeNull();
    expect(screen.queryByText('250 m')).toBeNull();
    expect(screen.getByTestId('place-save')).toBeEnabled();
  });

  it("takes the map's name for the point, and hands the spot to the meeting form", async () => {
    await render(<PlaceEditor />);
    await act(async () => {
      mockMap.onSettle?.({ center: [28.985, 41.037], zoom: 15 });
      await Promise.resolve();
    });
    expect(screen.getByPlaceholderText('Taksim')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('place-save'));
    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledWith(
        CIRCLE,
        expect.objectContaining({ name: 'Taksim', emoji: '📍', radius: 250 }),
      );
    });
    const saved = mockSave.mock.calls[0]?.[1];
    expect(useMeetingPlaceDraft.getState()).toEqual({ circleId: CIRCLE, placeId: saved?.id });
    // This phone remembers it added the spot: only such a place ever goes with a meeting.
    expect(JSON.parse(mockVault.get('meeting:spots:v1') ?? '[]')).toEqual([saved?.id]);
    expect(toast.success).not.toHaveBeenCalled();
    expect(router.back).toHaveBeenCalled();
  });

  it('keeps a name typed for it', async () => {
    await render(<PlaceEditor />);
    await fireEvent.changeText(screen.getByTestId('place-name'), 'Kuğulu Park');
    await fireEvent.press(screen.getByTestId('place-save'));
    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledWith(
        CIRCLE,
        expect.objectContaining({ name: 'Kuğulu Park' }),
      );
    });
  });
});
