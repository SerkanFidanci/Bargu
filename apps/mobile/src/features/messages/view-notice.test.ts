const mockStore = new Map<string, string>();
const mockOpen = { current: true };
jest.mock('../storage/vault', () => ({
  isVaultOpen: () => mockOpen.current,
  vault: () => ({
    get: (key: string) => mockStore.get(key),
    set: (key: string, value: string) => {
      mockStore.set(key, value);
    },
    delete: (key: string) => {
      mockStore.delete(key);
    },
  }),
}));

import { firstViewNotice } from './view-notice';

beforeEach(() => {
  mockStore.clear();
  mockOpen.current = true;
});

describe('"Açtığını {ad} görür." (docs/ADR/0035 Ek 1, the PM 2026-10-29)', () => {
  it('is told once on this phone, and never again (kept in the vault, across restarts)', () => {
    expect(firstViewNotice()).toBe(true);
    expect(firstViewNotice()).toBe(false);
    expect([...mockStore.values()]).toEqual(['1']);
  });

  it('waits for the vault: nothing is used up before it is open', () => {
    mockOpen.current = false;
    expect(firstViewNotice()).toBe(false);
    mockOpen.current = true;
    expect(firstViewNotice()).toBe(true);
  });
});
