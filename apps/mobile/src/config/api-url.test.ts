import { DEV_API_PORT, resolveApiUrl } from './api-url';

describe('resolveApiUrl', () => {
  it('uses the configured URL and trims trailing slashes', () => {
    expect(
      resolveApiUrl({
        configuredUrl: 'https://api.example.com/',
        hostUri: '192.168.1.20:8081',
        isDev: false,
      }),
    ).toBe('https://api.example.com');
  });

  it('requires HTTPS in release builds', () => {
    expect(() =>
      resolveApiUrl({ configuredUrl: 'http://api.example.com', hostUri: undefined, isDev: false }),
    ).toThrow('https');
  });

  it('allows plain HTTP in development', () => {
    expect(
      resolveApiUrl({ configuredUrl: 'http://10.0.2.2:3000', hostUri: undefined, isDev: true }),
    ).toBe('http://10.0.2.2:3000');
  });

  it('derives the dev API from the Metro host', () => {
    expect(
      resolveApiUrl({ configuredUrl: undefined, hostUri: '192.168.1.20:8081', isDev: true }),
    ).toBe(`http://192.168.1.20:${String(DEV_API_PORT)}`);
  });

  it('fails fast in release builds without a configured URL', () => {
    expect(() =>
      resolveApiUrl({ configuredUrl: undefined, hostUri: '192.168.1.20:8081', isDev: false }),
    ).toThrow('EXPO_PUBLIC_API_URL is required');
  });

  it('rejects non-http schemes', () => {
    expect(() =>
      resolveApiUrl({ configuredUrl: 'javascript:alert(1)', hostUri: undefined, isDev: true }),
    ).toThrow();
  });
});
