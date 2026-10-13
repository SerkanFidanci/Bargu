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
