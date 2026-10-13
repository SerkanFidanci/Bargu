import { describe, expect, it } from 'vitest';

import { InvalidEnvError, parseEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgres://user:s3cret-pass@localhost:5432/bargu',
  REDIS_URL: 'redis://default:s3cret-pass@localhost:6379',
};

describe('parseEnv', () => {
  it('applies safe defaults', () => {
    const env = parseEnv(base);
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: 3000,
      LOG_LEVEL: 'info',
      TRUST_PROXY: [],
    });
  });

  it('coerces and validates values', () => {
    const env = parseEnv({ ...base, PORT: '8080', HOST: '0.0.0.0', NODE_ENV: 'production' });
    expect(env.PORT).toBe(8080);
    expect(env.HOST).toBe('0.0.0.0');
    expect(env.NODE_ENV).toBe('production');
  });

  it('parses the trusted proxy list', () => {
    const env = parseEnv({ ...base, TRUST_PROXY: ' 172.30.0.0/24, 10.0.0.1 ,' });
    expect(env.TRUST_PROXY).toEqual(['172.30.0.0/24', '10.0.0.1']);
  });

  it.each([
    ['missing DATABASE_URL', { REDIS_URL: base.REDIS_URL }],
    ['non-postgres DATABASE_URL', { ...base, DATABASE_URL: 'mysql://u:p@localhost/db' }],
    ['non-redis REDIS_URL', { ...base, REDIS_URL: 'http://localhost:6379' }],
    ['out of range PORT', { ...base, PORT: '70000' }],
    ['unknown LOG_LEVEL', { ...base, LOG_LEVEL: 'verbose' }],
    ['hostname as HOST', { ...base, HOST: 'localhost' }],
    ['invalid TRUST_PROXY entry', { ...base, TRUST_PROXY: 'caddy' }],
  ])('rejects %s', (_, source) => {
    expect(() => parseEnv(source)).toThrow(InvalidEnvError);
  });

  it('names the failing variable without echoing secret values', () => {
    const source = { ...base, DATABASE_URL: 'mysql://user:s3cret-pass@localhost/db' };
    let message = '';
    try {
      parseEnv(source);
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toContain('DATABASE_URL');
    expect(message).not.toContain('s3cret-pass');
  });
});
