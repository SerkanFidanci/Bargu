import { join } from 'node:path';

import createConfig from '../../app.config';
import easJson from '../../eas.json';

/**
 * The store-release rules that live in configuration files (apps/mobile/README.md "Mağaza sürümü"): a
 * wrong edit here would not fail any other test, only a store upload weeks later.
 */
interface BuildProfile {
  extends?: string;
  node?: string;
  pnpm?: string;
  distribution?: string;
  autoIncrement?: boolean;
  env?: Record<string, string>;
  android?: { buildType?: string };
}

interface EasJson {
  cli: { appVersionSource: string };
  build: Record<string, BuildProfile>;
}

const eas: EasJson = easJson;

/** Flags that switch developer-only code on (see scripts/check-bundle.mjs). */
const DEV_FLAGS = ['EXPO_PUBLIC_DEV_TOOLS', 'EXPO_PUBLIC_BG_LIVE', 'EXPO_PUBLIC_COSMETIC_KEYS'];

function profile(name: string): BuildProfile {
  const found = eas.build[name];
  if (found === undefined) throw new Error(`eas.json has no "${name}" profile`);
  return found;
}

describe('EAS build profiles', () => {
  it('builds the store release as an app bundle (K1): Google Play takes no APK', () => {
    expect(profile('production').android?.buildType).toBe('app-bundle');
    expect(profile('production').distribution).toBe('store');
  });

  it('keeps the test builds installable by hand: preview and development stay APKs', () => {
    expect(profile('preview').android?.buildType).toBe('apk');
    expect(profile('development').android?.buildType).toBe('apk');
  });

  it('numbers the versionCode from one remote counter that only goes up (K4)', () => {
    // EAS keeps the counter; cloud and local production builds share it. "local" would make every
    // machine count on its own.
    expect(eas.cli.appVersionSource).toBe('remote');
    expect(profile('production').autoIncrement).toBe(true);
    // A versionCode written here would be ignored today and win the day someone flips the source.
    const android = createConfig({
      projectRoot: join(__dirname, '../..'),
      staticConfigPath: null,
      packageJsonPath: null,
      config: {},
    }).android;
    expect(android).toBeDefined();
    expect(android).not.toHaveProperty('versionCode');
  });

  it('turns no developer or staging flag on for production', () => {
    const base = profile('base').env ?? {};
    const production = profile('production').env ?? {};
    for (const flag of DEV_FLAGS) {
      expect(base).not.toHaveProperty(flag);
      expect(production).not.toHaveProperty(flag);
    }
  });
});
