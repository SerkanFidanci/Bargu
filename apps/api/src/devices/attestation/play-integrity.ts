import { z } from 'zod';

import { GoogleAccessTokens, parseServiceAccount } from '../../infra/google/service-account.js';

const SCOPE = 'https://www.googleapis.com/auth/playintegrity';
/** A verdict older than this is not accepted (Google recommends a short window). */
const MAX_VERDICT_AGE_MS = 5 * 60 * 1000;

const verdictSchema = z.object({
  tokenPayloadExternal: z.object({
    requestDetails: z.object({
      requestPackageName: z.string(),
      requestHash: z.string(),
      timestampMillis: z.coerce.number(),
    }),
    appIntegrity: z.object({
      appRecognitionVerdict: z.string(),
      packageName: z.string().optional(),
      certificateSha256Digest: z.array(z.string()).optional(),
    }),
    deviceIntegrity: z.object({ deviceRecognitionVerdict: z.array(z.string()).optional() }),
  }),
});

export type PlayIntegrityResult = 'valid' | 'invalid' | 'unavailable';

export interface PlayIntegrityConfig {
  packageName: string;
  /** Upper-case `AA:BB:…` SHA-256 fingerprints of the app signing certificates. */
  certificateFingerprints: readonly string[];
  /** Service account JSON, base64. */
  serviceAccount: string;
  fetch?: typeof fetch;
  now?: () => number;
}

const fingerprintToBase64url = (fingerprint: string) =>
  Buffer.from(fingerprint.replaceAll(':', ''), 'hex').toString('base64url');

/**
 * Play Integrity standard request, decoded server-side by Google (the app never sees the verdict
 * key). Accepts only: our package, the expected request hash, a fresh verdict, a Play-recognised
 * build signed with our certificate, on a device that meets device integrity.
 */
export class PlayIntegrityVerifier {
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private readonly tokens: GoogleAccessTokens;

  constructor(private readonly config: PlayIntegrityConfig) {
    this.fetch = config.fetch ?? fetch;
    this.now = config.now ?? Date.now;
    this.tokens = new GoogleAccessTokens(
      parseServiceAccount(config.serviceAccount),
      SCOPE,
      this.fetch,
      this.now,
    );
  }

  /**
   * `unavailable` when Google cannot be asked (network, outage, our OAuth token): the caller answers
   * 503 instead of calling a genuine device invalid.
   */
  async verify(token: string, expectedRequestHash: string): Promise<PlayIntegrityResult> {
    let response: Response;
    try {
      response = await this.fetch(
        `https://playintegrity.googleapis.com/v1/${encodeURIComponent(this.config.packageName)}:decodeIntegrityToken`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${await this.tokens.get()}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ integrity_token: token }),
          signal: AbortSignal.timeout(5_000),
        },
      );
    } catch {
      return 'unavailable';
    }
    if (response.status >= 500 || response.status === 429) return 'unavailable';
    if (!response.ok) return 'invalid';
    let verdict: z.infer<typeof verdictSchema>;
    try {
      verdict = verdictSchema.parse(await response.json());
    } catch {
      return 'invalid';
    }

    const { requestDetails, appIntegrity, deviceIntegrity } = verdict.tokenPayloadExternal;
    const allowed = new Set(this.config.certificateFingerprints.map(fingerprintToBase64url));
    const age = this.now() - requestDetails.timestampMillis;
    const valid =
      requestDetails.requestPackageName === this.config.packageName &&
      requestDetails.requestHash === expectedRequestHash &&
      age >= -60_000 &&
      age <= MAX_VERDICT_AGE_MS &&
      appIntegrity.appRecognitionVerdict === 'PLAY_RECOGNIZED' &&
      appIntegrity.packageName === this.config.packageName &&
      (appIntegrity.certificateSha256Digest ?? []).some((digest) =>
        allowed.has(digest.replace(/=+$/, '').replaceAll('+', '-').replaceAll('/', '_')),
      ) &&
      (deviceIntegrity.deviceRecognitionVerdict ?? []).includes('MEETS_DEVICE_INTEGRITY');
    return valid ? 'valid' : 'invalid';
  }
}
