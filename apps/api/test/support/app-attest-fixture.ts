// Builds App Attest attestations the way Apple's servers do, but under a test CA, so the verifier
// can be exercised end to end without an iPhone or an Apple Developer account.
import { sha256 } from '@bargu/crypto';
import {
  BasicConstraintsExtension,
  Extension,
  X509CertificateGenerator,
  type X509Certificate,
} from '@peculiar/x509';
import { isoCBOR } from '@simplewebauthn/server/helpers';

const subtle = globalThis.crypto.subtle;
const encoder = new TextEncoder();
const P384 = { name: 'ECDSA', namedCurve: 'P-384' } as const;
const P256 = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN_384 = { name: 'ECDSA', hash: 'SHA-384' } as const;
const DAY = 24 * 3600 * 1000;

export interface TestCa {
  rootPem: string;
  root: X509Certificate;
  intermediate: X509Certificate;
  intermediateKey: CryptoKey;
}

async function keyPair(params: EcKeyGenParams): Promise<CryptoKeyPair> {
  return subtle.generateKey(params, true, ['sign', 'verify']);
}

export async function createTestCa(now = new Date()): Promise<TestCa> {
  const rootKeys = await keyPair(P384);
  const root = await X509CertificateGenerator.createSelfSigned({
    name: 'CN=Test App Attestation Root CA, O=Bargu Tests',
    keys: rootKeys,
    signingAlgorithm: SIGN_384,
    notBefore: new Date(now.getTime() - DAY),
    notAfter: new Date(now.getTime() + 365 * DAY),
    extensions: [new BasicConstraintsExtension(true, undefined, true)],
  });
  const intermediateKeys = await keyPair(P384);
  const intermediate = await X509CertificateGenerator.create({
    subject: 'CN=Test App Attestation CA 1, O=Bargu Tests',
    issuer: root.subject,
    publicKey: intermediateKeys.publicKey,
    signingKey: rootKeys.privateKey,
    signingAlgorithm: SIGN_384,
    notBefore: new Date(now.getTime() - DAY),
    notAfter: new Date(now.getTime() + 30 * DAY),
    extensions: [new BasicConstraintsExtension(true, 0, true)],
  });
  return {
    rootPem: root.toString('pem'),
    root,
    intermediate,
    intermediateKey: intermediateKeys.privateKey,
  };
}

export interface AttestationOptions {
  appId: string;
  environment: 'development' | 'production';
  clientDataHash: Uint8Array;
  /** Deliberate defects, one at a time. */
  counter?: number;
  omitNonce?: boolean;
  wrongNonce?: boolean;
  wrongKeyId?: boolean;
  fmt?: string;
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

export async function createAttestation(
  ca: TestCa,
  options: AttestationOptions,
): Promise<{ keyId: string; attestation: string }> {
  const keys = await keyPair(P256);
  const point = new Uint8Array(await subtle.exportKey('raw', keys.publicKey));
  const jwk = await subtle.exportKey('jwk', keys.publicKey);
  const credentialId = sha256(point);

  const aaguid =
    options.environment === 'development'
      ? encoder.encode('appattestdevelop')
      : concat(encoder.encode('appattest'), new Uint8Array(7));
  const counter = new Uint8Array(4);
  new DataView(counter.buffer).setUint32(0, options.counter ?? 0);
  const idLength = Uint8Array.of(0, credentialId.length);
  const cose = isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, new Uint8Array(Buffer.from(jwk.x ?? '', 'base64url'))],
      [-3, new Uint8Array(Buffer.from(jwk.y ?? '', 'base64url'))],
    ]),
  );
  const authData = concat(
    sha256(encoder.encode(options.appId)),
    Uint8Array.of(0x40),
    counter,
    aaguid,
    idLength,
    credentialId,
    cose,
  );

  const nonce = sha256(concat(authData, options.clientDataHash));
  if (options.wrongNonce === true) nonce[0] = (nonce[0] ?? 0) ^ 1;
  const extensions =
    options.omitNonce === true
      ? []
      : [
          new Extension(
            '1.2.840.113635.100.8.2',
            false,
            concat(Uint8Array.of(0x30, 0x24, 0xa1, 0x22, 0x04, 0x20), nonce),
          ),
        ];
  const credential = await X509CertificateGenerator.create({
    subject: 'CN=test-credential, O=Bargu Tests',
    issuer: ca.intermediate.subject,
    publicKey: keys.publicKey,
    signingKey: ca.intermediateKey,
    signingAlgorithm: SIGN_384,
    notBefore: new Date(Date.now() - DAY),
    notAfter: new Date(Date.now() + 3 * DAY),
    extensions,
  });

  const attestationObject = isoCBOR.encode(
    new Map<string, unknown>([
      ['fmt', options.fmt ?? 'apple-appattest'],
      [
        'attStmt',
        new Map<string, unknown>([
          ['x5c', [new Uint8Array(credential.rawData), new Uint8Array(ca.intermediate.rawData)]],
          ['receipt', new Uint8Array(16)],
        ]),
      ],
      ['authData', authData],
    ]) as Parameters<typeof isoCBOR.encode>[0],
  );
  const keyId = options.wrongKeyId === true ? sha256(credentialId) : credentialId;
  return {
    keyId: Buffer.from(keyId).toString('base64'),
    attestation: Buffer.from(attestationObject).toString('base64'),
  };
}
