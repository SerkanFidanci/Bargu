// @peculiar/x509 resolves its parsers through tsyringe, which needs the metadata polyfill first.
import 'reflect-metadata';

import { bytesEqual, sha256 } from '@bargu/crypto';
import { X509Certificate } from '@peculiar/x509';
import { decodeAttestationObject, parseAuthenticatorData } from '@simplewebauthn/server/helpers';

/**
 * Apple App Attestation Root CA, from https://www.apple.com/certificateauthority/ (fetched
 * 2026-10-13). Pinned by SHA-256 fingerprint as well, so an edited PEM fails at startup.
 */
export const APPLE_APP_ATTEST_ROOT_PEM = `-----BEGIN CERTIFICATE-----
MIICITCCAaegAwIBAgIQC/O+DvHN0uD7jG5yH2IXmDAKBggqhkjOPQQDAzBSMSYw
JAYDVQQDDB1BcHBsZSBBcHAgQXR0ZXN0YXRpb24gUm9vdCBDQTETMBEGA1UECgwK
QXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yMDAzMTgxODMyNTNa
Fw00NTAzMTUwMDAwMDBaMFIxJjAkBgNVBAMMHUFwcGxlIEFwcCBBdHRlc3RhdGlv
biBSb290IENBMRMwEQYDVQQKDApBcHBsZSBJbmMuMRMwEQYDVQQIDApDYWxpZm9y
bmlhMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAERTHhmLW07ATaFQIEVwTtT4dyctdh
NbJhFs/Ii2FdCgAHGbpphY3+d8qjuDngIN3WVhQUBHAoMeQ/cLiP1sOUtgjqK9au
Yen1mMEvRq9Sk3Jm5X8U62H+xTD3FE9TgS41o0IwQDAPBgNVHRMBAf8EBTADAQH/
MB0GA1UdDgQWBBSskRBTM72+aEH/pwyp5frq5eWKoTAOBgNVHQ8BAf8EBAMCAQYw
CgYIKoZIzj0EAwMDaAAwZQIwQgFGnByvsiVbpTKwSga0kP0e8EeDS4+sQmTvb7vn
53O5+FRXgeLhpJ06ysC5PrOyAjEAp5U4xDgEgllF7En3VcE3iexZZtKeYnpqtijV
oyFraWVIyd/dganmrduC1bmTBGwD
-----END CERTIFICATE-----`;
/** SHA-256 of the root certificate (DER), hex. */
export const APPLE_APP_ATTEST_ROOT_SHA256 =
  '1cb9823ba28ba6ad2d33a006941de2ae4f513ef1d4e831b9f7e0fa7b6242c932';

/** Apple's OID carrying the attestation nonce in the credential certificate. */
const NONCE_EXTENSION_OID = '1.2.840.113635.100.8.2';
// SEQUENCE(36) { [1](34) { OCTET STRING(32) nonce } }: the only layout Apple produces.
const NONCE_EXTENSION_PREFIX = Uint8Array.of(0x30, 0x24, 0xa1, 0x22, 0x04, 0x20);

const encoder = new TextEncoder();
const AAGUID = {
  production: Uint8Array.from([...encoder.encode('appattest'), 0, 0, 0, 0, 0, 0, 0]),
  development: encoder.encode('appattestdevelop'),
} as const;

export interface AppAttestInput {
  /** Key id from `DCAppAttestService.generateKey` (base64). */
  keyId: string;
  /** Attestation object (base64 CBOR). */
  attestation: string;
  /** SHA-256 of the data the app attested (challenge bound to its identity key). */
  clientDataHash: Uint8Array;
}

export interface AppAttestConfig {
  /** `TEAMID.bundle.id` */
  appId: string;
  environment: 'development' | 'production';
  /** Trust anchor; the Apple root in production, a test CA in tests. */
  rootPem: string;
  now?: () => Date;
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

/** SHA-256 of a certificate's DER encoding, hex (for pinning). */
export function certificateSha256(pem: string): string {
  return Buffer.from(sha256(new Uint8Array(new X509Certificate(pem).rawData))).toString('hex');
}

/**
 * Verifies an App Attest attestation as Apple specifies ("Validating apps that connect to your
 * server", steps 1–9). Resolves to false on any mismatch; never throws for bad input.
 */
export async function verifyAppAttest(
  input: AppAttestInput,
  config: AppAttestConfig,
): Promise<boolean> {
  try {
    const now = config.now?.() ?? new Date();
    const decoded = decodeAttestationObject(Buffer.from(input.attestation, 'base64'));
    if ((decoded.get('fmt') as string) !== 'apple-appattest') return false;
    const x5c = decoded.get('attStmt').get('x5c');
    const authData = decoded.get('authData');
    if (x5c?.length !== 2 || x5c[0] === undefined || x5c[1] === undefined) return false;

    // 1. Chain: credential certificate ← intermediate ← pinned root, each valid at `now`.
    const root = new X509Certificate(config.rootPem);
    const credential = new X509Certificate(x5c[0]);
    const intermediate = new X509Certificate(x5c[1]);
    const chainValid =
      credential.issuer === intermediate.subject &&
      intermediate.issuer === root.subject &&
      (await credential.verify({ publicKey: intermediate.publicKey, date: now })) &&
      (await intermediate.verify({ publicKey: root.publicKey, date: now })) &&
      (await root.verify({ date: now }));
    if (!chainValid) return false;

    // 2–4. nonce = SHA256(authData ‖ clientDataHash) must sit in the credential certificate.
    const nonce = sha256(concat(authData, input.clientDataHash));
    const extension = credential.getExtension(NONCE_EXTENSION_OID);
    if (extension === null) return false;
    if (!bytesEqual(new Uint8Array(extension.value), concat(NONCE_EXTENSION_PREFIX, nonce))) {
      return false;
    }

    // 5. The key id is the SHA-256 of the credential's public key (uncompressed EC point).
    const keyId = new Uint8Array(Buffer.from(input.keyId, 'base64'));
    const spki = new Uint8Array(credential.publicKey.rawData);
    const point = spki.subarray(spki.length - 65);
    if (point[0] !== 0x04 || !bytesEqual(sha256(point), keyId)) return false;

    // 6–9. Authenticator data: our app id, fresh counter, environment, credential id = key id.
    const parsed = parseAuthenticatorData(authData);
    return (
      bytesEqual(parsed.rpIdHash, sha256(encoder.encode(config.appId))) &&
      parsed.counter === 0 &&
      parsed.aaguid !== undefined &&
      bytesEqual(parsed.aaguid, AAGUID[config.environment]) &&
      parsed.credentialID !== undefined &&
      bytesEqual(parsed.credentialID, keyId)
    );
  } catch {
    return false;
  }
}
