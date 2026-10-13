import { runCryptoBenchmark } from './crypto-benchmark';

describe('runCryptoBenchmark', () => {
  // Regression test for the first device run, which failed: warm-up and timed calls decrypted the
  // same envelopes, and the replay guard (correctly) rejected the second attempt.
  it('runs every operation once per call without tripping replay protection', () => {
    const results = runCryptoBenchmark(0.05);

    expect(results.map((result) => result.id)).toEqual([
      'encrypt',
      'send',
      'decrypt',
      'distribute',
      'seal',
      'keygen',
      'safetyNumber',
    ]);
    for (const result of results) {
      expect(result.iterations).toBeGreaterThan(0);
      expect(result.medianMs).toBeGreaterThanOrEqual(0);
      expect(result.p95Ms).toBeGreaterThanOrEqual(result.medianMs);
    }
  });
});
