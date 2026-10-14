import { readFileSync } from 'node:fs';

/** Line endings as git checks the files out on Windows or elsewhere. */
const normalized = (text: string) => text.split('\r\n').join('\n');

/**
 * The iOS notification extension compiles its own copy of the Swift protocol code (Xcode targets
 * cannot reach into packages/); this keeps it identical to the copy the CryptoKit cross-
 * implementation tests run against (packages/crypto/swift, CI "Swift (CryptoKit)").
 */
describe('notification extension sources', () => {
  it('carry the tested Swift protocol code unchanged', () => {
    // Paths from apps/mobile, where the tests run.
    const copy = readFileSync('targets/notification-service/BarguCrypto.swift', 'utf8');
    const tested = readFileSync(
      '../../packages/crypto/swift/Sources/BarguCrypto/BarguCrypto.swift',
      'utf8',
    );
    expect(normalized(copy)).toBe(normalized(tested));
  });
});
