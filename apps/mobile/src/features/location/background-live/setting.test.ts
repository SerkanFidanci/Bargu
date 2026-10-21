import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { guardianRulesSchema, guardianSettingsSchema } from '@bargu/schemas';

import {
  backgroundLiveOn,
  DEFAULT_SHARING,
  loadSharing,
  saveSharing,
  type SharingSettings,
  withAdultDefaults,
  withMinorSharing,
} from '../sharing';
import { memoryStore } from '../test-support';

describe('the "Arka planda canlı konum" setting (docs/ADR/0028 step 3)', () => {
  it('starts on for 18+ once the age band is known, and off before that', () => {
    expect(backgroundLiveOn(DEFAULT_SHARING)).toBe(false);
    expect(backgroundLiveOn(withAdultDefaults(DEFAULT_SHARING))).toBe(true);
  });

  it('starts off for 15–17, whatever the phone had before, and the teen alone can turn it on', () => {
    const teen = withMinorSharing(DEFAULT_SHARING, []);
    expect(teen.backgroundLiveDefault).toBe('off');
    expect(backgroundLiveOn(teen)).toBe(false);
    // The teen turns it on (the switch writes the choice on this phone).
    const chosen: SharingSettings = { ...teen, backgroundLive: 'on' };
    expect(backgroundLiveOn(chosen)).toBe(true);
    // The rules of 15–17 apply again at every start: the choice stays.
    expect(withMinorSharing(chosen, [])).toBe(chosen);
    expect(backgroundLiveOn(withMinorSharing(chosen, []))).toBe(true);
    // And back off.
    expect(backgroundLiveOn({ ...chosen, backgroundLive: 'off' })).toBe(false);
  });

  it('is not carried over when an adult phone first gets the rules of 15–17', () => {
    const adult: SharingSettings = { ...withAdultDefaults(DEFAULT_SHARING), backgroundLive: 'on' };
    const teen = withMinorSharing(adult, []);
    expect(backgroundLiveOn(teen)).toBe(false);
    expect(teen.backgroundLive).toBeUndefined();
  });

  it('leaves a phone that had the rules of 15–17 before this setting existed off', () => {
    const before: SharingSettings = { ...DEFAULT_SHARING, newCircles: 'off', speed: 'hide' };
    expect(backgroundLiveOn(before)).toBe(false);
    const after = withMinorSharing(before, []);
    expect(backgroundLiveOn(after)).toBe(false);
    expect(after.backgroundLiveDefault).toBe('off');
  });

  it('keeps an adult’s choice, and does not turn it back on for a teen’s phone', () => {
    const off: SharingSettings = { ...withAdultDefaults(DEFAULT_SHARING), backgroundLive: 'off' };
    expect(backgroundLiveOn(withAdultDefaults(off))).toBe(false);
    const teen = withMinorSharing(DEFAULT_SHARING, []);
    expect(withAdultDefaults(teen)).toBe(teen);
    expect(backgroundLiveOn(withAdultDefaults(teen))).toBe(false);
  });

  it('is kept on this phone only, in the sharing choices of the encrypted vault', () => {
    const store = memoryStore();
    const settings: SharingSettings = {
      ...withAdultDefaults(DEFAULT_SHARING),
      backgroundLive: 'off',
    };
    saveSharing(store, settings);
    expect(loadSharing(store)).toEqual(settings);
  });
});

describe('guardian tools (docs/ADR/0023 §5) do not carry it', () => {
  it('has no field for it in what a parent sets or the child phone receives', () => {
    expect(Object.keys(guardianSettingsSchema.shape).sort()).toEqual([
      'approveNewPeople',
      'dailyLimitMinutes',
    ]);
    const rules = { approveNewPeople: true, dailyLimitMinutes: null };
    expect(guardianSettingsSchema.safeParse(rules).success).toBe(true);
    for (const extra of [{ backgroundLive: 'on' }, { backgroundLiveDefault: 'on' }]) {
      expect(guardianSettingsSchema.safeParse({ ...rules, ...extra }).success).toBe(false);
      expect(
        guardianRulesSchema.safeParse({ linked: true, settings: { ...rules, ...extra } }).success,
      ).toBe(false);
    }
  });

  it('is not mentioned anywhere in the guardian screens and code of the app', () => {
    const root = resolve(__dirname, '../../..');
    const sources = (dir: string): string[] =>
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- this app's own source folders
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- this app's own source folders
        if (statSync(path).isDirectory()) return sources(path);
        return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
      });
    const guardian = [
      ...sources(join(root, 'features', 'guardians')),
      ...sources(join(root, 'app', '(app)', 'guardians')),
    ];
    expect(guardian.length).toBeGreaterThan(0);
    for (const file of guardian) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- this app's own source files
      expect(readFileSync(file, 'utf8')).not.toMatch(/backgroundLive|background-live/);
    }
  });
});
