import { devResources } from './dev-resources';
import { DEFAULT_LANGUAGE, resolveLanguage, resources } from './index';

function keyPaths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keyPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('i18n', () => {
  it('defaults to Turkish', () => {
    expect(DEFAULT_LANGUAGE).toBe('tr');
    expect(resolveLanguage(undefined)).toBe('tr');
    expect(resolveLanguage('de')).toBe('tr');
  });

  it('uses English when the device asks for it', () => {
    expect(resolveLanguage('en')).toBe('en');
  });

  it('has the same keys in every language', () => {
    const turkish = keyPaths(resources.tr.translation).sort();
    const english = keyPaths(resources.en.translation).sort();
    expect(english).toEqual(turkish);
  });

  // Hermes may lack Intl.PluralRules: texts are phrased so one form fits every count.
  it('uses no plural forms', () => {
    for (const language of Object.values(resources)) {
      expect(
        keyPaths(language.translation).filter((path) =>
          /_(zero|one|two|few|many|other)$/.test(path),
        ),
      ).toEqual([]);
    }
  });

  it('has no empty translations', () => {
    for (const language of Object.values(resources)) {
      const values = keyPaths(language.translation).map((path) =>
        path
          .split('.')
          .reduce<unknown>(
            (node, key) => (node as Record<string, unknown>)[key],
            language.translation,
          ),
      );
      expect(values.every((text) => typeof text === 'string' && text.trim().length > 0)).toBe(true);
    }
  });
});

// The developer tools' texts are loaded only by development and preview builds (dev-resources.ts):
// they must not be in the catalogue every build ships (scripts/check-bundle.mjs checks the bundle).
describe('developer texts', () => {
  it('are not in the shipped catalogue', () => {
    for (const language of Object.values(resources)) {
      expect(Object.keys(language.translation)).not.toContain('dev');
    }
  });

  it('have the same keys in every language', () => {
    expect(keyPaths(devResources.en).sort()).toEqual(keyPaths(devResources.tr).sort());
  });

  it('have no empty texts', () => {
    for (const language of Object.values(devResources)) {
      const texts = JSON.stringify(language).match(/"[^"]*":\s*""/g);
      expect(texts).toBeNull();
    }
  });
});
