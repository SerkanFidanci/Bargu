import { fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '@/i18n';

import { useDevSlots } from './slots';
// Loading the file is what index.ts does behind the build-time flag.
import './tools';

// Native modules jest does not have on Linux (CI), though Windows resolves them.
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/config/env', () => ({
  env: { apiUrl: 'https://api.test', mapUrl: 'https://api.test/map', appVersion: '1.2.3' },
  DEV_TOOLS_ENABLED: true,
}));
const mockPush = jest.fn<undefined, [unknown]>();
// expo-router's native stack needs a native view jest does not have on Linux (CI).
jest.mock('expo-router', () => ({
  router: {
    back: jest.fn(),
    push: (route: unknown) => {
      mockPush(route);
    },
  },
  Stack: { Screen: () => null },
  useTheme: () => ({ colors: {} }),
}));
jest.mock('@/features/location/engine', () => ({
  useMyFix: { getState: () => ({ fix: null }) },
}));
// The map needs MapLibre's native views (the swarm's drawing is not what is tested here).
jest.mock('@/features/map/gliding-marker', () => ({ GlidingMarker: () => null }));
jest.mock('@/features/map/map-avatar', () => ({ MapAvatar: () => null }));
jest.mock('@/features/map/people-layer', () => ({ LOW_BATTERY: 15 }));

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});

describe('the developer tools a development or preview build loads (index.ts)', () => {
  it('fill every place the screens read, and bring their own texts', () => {
    const slots = useDevSlots.getState();
    expect(slots.aboutRows).not.toBeNull();
    expect(slots.swarmLayer).not.toBeNull();
    expect(slots.swarmPanel).not.toBeNull();
    expect(Object.keys(slots.screens).sort()).toEqual(['billing', 'crypto', 'ui']);
    // The texts are not in the shipped catalogue; loading the tools adds them, in both languages.
    expect(i18n.t('dev.ui.link')).toBe('Geliştirici: bileşen galerisi');
    expect(i18n.t('dev.crypto.link', { lng: 'en' })).toBe('Developer: crypto benchmark');
  });

  it('draw the developer rows of the "Uygulama" screen, each leading to its screen', async () => {
    const rows = useDevSlots.getState().aboutRows;
    if (rows === null) throw new Error('the tools did not fill the "Uygulama" slot');
    await render(rows);
    await fireEvent.press(screen.getByText('Geliştirici: bileşen galerisi'));
    expect(mockPush).toHaveBeenLastCalledWith('/_dev/ui');
    await fireEvent.press(screen.getByText('Ödeme taklidi (test)'));
    expect(mockPush).toHaveBeenLastCalledWith('/_dev/billing');
    await fireEvent.press(screen.getByText('Geliştirici: kripto hız testi'));
    expect(mockPush).toHaveBeenLastCalledWith('/_dev/crypto');
  });
});
