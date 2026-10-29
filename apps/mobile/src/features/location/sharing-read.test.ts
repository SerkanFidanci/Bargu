import {
  circleSharing,
  DEFAULT_SHARING,
  isSharingWith,
  readSharing,
  saveSharing,
  type SharingSettings,
} from './sharing';
import { memoryStore } from './test-support';

// The PM, 2026-10-29: "okunamayan ayar, tam konum demek değildir". Settings a newer version wrote
// are read as far as they can be; what cannot be read shares with nobody, and the user is told.

const NOW = 1_800_000_000_000;
const HOME = '0190a8a0-0000-7000-8000-0000000000a1';
const CLUB = '0190a8a0-0000-7000-8000-0000000000a2';
const NEW = '0190a8a0-0000-7000-8000-0000000000a3';

const saved = (raw: string) => {
  const store = memoryStore();
  store.set('sharing:v1', raw);
  return store;
};

describe('reading the saved sharing settings', () => {
  it('reads what was saved, and nothing saved is the default', () => {
    const settings: SharingSettings = {
      ...DEFAULT_SHARING,
      circles: { [HOME]: { sharing: true, precision: 'city', until: null } },
    };
    const store = memoryStore();
    expect(readSharing(store)).toEqual({ settings: DEFAULT_SHARING, unreadable: false });
    saveSharing(store, settings);
    expect(readSharing(store)).toEqual({ settings, unreadable: false });
  });

  it('drops a field it does not know, and keeps the rest', () => {
    const read = readSharing(
      saved(
        JSON.stringify({
          ghost: 'off',
          future: true,
          circles: {
            [HOME]: { sharing: true, precision: 'neighborhood', until: null, sparkles: 3 },
          },
        }),
      ),
    );
    expect(read.unreadable).toBe(false);
    expect(read.settings.circles[HOME]).toEqual({
      sharing: true,
      precision: 'neighborhood',
      until: null,
    });
  });

  it('shares nothing with a circle whose choice cannot be read, and says so', () => {
    const read = readSharing(
      saved(
        JSON.stringify({
          ghost: 'off',
          circles: {
            [HOME]: { sharing: true, precision: 'street', until: null },
            [CLUB]: { sharing: true, precision: 'exact', until: null },
          },
        }),
      ),
    );
    expect(read.unreadable).toBe(true);
    expect(isSharingWith(read.settings, HOME, NOW)).toBe(false);
    expect(isSharingWith(read.settings, CLUB, NOW)).toBe(true);
  });

  it('shares with nobody when nothing can be read: not the full location everywhere', () => {
    for (const raw of ['{not json', JSON.stringify({ ghost: 'sometimes', circles: {} }), '[]']) {
      const read = readSharing(saved(raw));
      expect(read.unreadable).toBe(true);
      expect(isSharingWith(read.settings, HOME, NOW)).toBe(false);
      // A circle joined later starts unshared too, until the user chooses.
      expect(circleSharing(read.settings, NEW).sharing).toBe(false);
    }
  });
});
