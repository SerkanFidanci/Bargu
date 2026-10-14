import { describe, expect, it } from 'vitest';

import { isTestAddress, mustUpgradeToTls } from './mailer.js';

describe('isTestAddress', () => {
  it('recognises the reserved .test domain only', () => {
    expect(isTestAddress('deneme-arkadas@example.test')).toBe(true);
    expect(isTestAddress('Someone@Sub.Example.TEST ')).toBe(true);
    expect(isTestAddress('ali@gmail.com')).toBe(false);
    expect(isTestAddress('ali@test.com')).toBe(false);
    expect(isTestAddress('ali@contest')).toBe(false);
  });
});

describe('mustUpgradeToTls', () => {
  it('lets the local Mailpit run in the clear outside production', () => {
    expect(mustUpgradeToTls('smtp://mailpit:1025', 'staging')).toBe(false);
  });

  it('never sends a password unencrypted (e.g. Gmail on port 587)', () => {
    expect(mustUpgradeToTls('smtp://user%40gmail.com:secret@smtp.gmail.com:587', 'staging')).toBe(
      true,
    );
  });

  it('always encrypts in production', () => {
    expect(mustUpgradeToTls('smtp://relay.internal:25', 'production')).toBe(true);
  });

  it('needs no upgrade when TLS is implicit', () => {
    expect(mustUpgradeToTls('smtps://user:secret@smtp.example:465', 'production')).toBe(false);
  });
});
