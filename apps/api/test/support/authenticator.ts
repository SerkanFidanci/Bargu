// A software WebAuthn authenticator (ES256, user verification on, "none" attestation): what a
// phone's passkey provider does, minus the secure hardware. Test-only.
import { randomUuid, sha256 } from '@bargu/crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';

const subtle = globalThis.crypto.subtle;
const encoder = new TextEncoder();
const b64u = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

/** WebCrypto gives r ‖ s; WebAuthn carries ES256 signatures DER-encoded. */
function derSignature(raw: Uint8Array): Uint8Array {
  const integer = (bytes: Uint8Array) => {
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0) start++;
    let value = bytes.subarray(start);
    if ((value[0] ?? 0) & 0x80) value = concat(Uint8Array.of(0), value);
    return concat(Uint8Array.of(0x02, value.length), value);
  };
  const body = concat(integer(raw.subarray(0, 32)), integer(raw.subarray(32)));
  return concat(Uint8Array.of(0x30, body.length), body);
}

const FLAGS = { userPresent: 0x01, userVerified: 0x04, attestedData: 0x40 } as const;

export class SoftwareAuthenticator {
  private counter = 0;

  private constructor(
    private readonly keys: CryptoKeyPair,
    readonly credentialId: Uint8Array,
  ) {}

  static async create(): Promise<SoftwareAuthenticator> {
    const keys = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ]);
    const id = new Uint8Array(Buffer.from(randomUuid().replaceAll('-', ''), 'hex'));
    return new SoftwareAuthenticator(keys, id);
  }

  get id(): string {
    return b64u(this.credentialId);
  }

  async register(options: { challenge: string; rp: { id?: string } }, origin: string) {
    const jwk = await subtle.exportKey('jwk', this.keys.publicKey);
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
      sha256(encoder.encode(options.rp.id ?? '')),
      Uint8Array.of(FLAGS.userPresent | FLAGS.userVerified | FLAGS.attestedData),
      new Uint8Array(4),
      new Uint8Array(16),
      Uint8Array.of(0, this.credentialId.length),
      this.credentialId,
      cose,
    );
    const clientData = encoder.encode(
      JSON.stringify({
        type: 'webauthn.create',
        challenge: options.challenge,
        origin,
        crossOrigin: false,
      }),
    );
    const attestationObject = isoCBOR.encode(
      new Map<string, unknown>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData],
      ]) as Parameters<typeof isoCBOR.encode>[0],
    );
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key' as const,
      response: {
        clientDataJSON: b64u(clientData),
        attestationObject: b64u(attestationObject),
        transports: ['internal'],
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform' as const,
    };
  }

  async assert(
    options: { challenge: string; rpId?: string },
    origin: string,
    userId: string,
    tamper: { counter?: number; signWith?: SoftwareAuthenticator } = {},
  ) {
    this.counter = tamper.counter ?? this.counter + 1;
    const counter = new Uint8Array(4);
    new DataView(counter.buffer).setUint32(0, this.counter);
    const authData = concat(
      sha256(encoder.encode(options.rpId ?? '')),
      Uint8Array.of(FLAGS.userPresent | FLAGS.userVerified),
      counter,
    );
    const clientData = encoder.encode(
      JSON.stringify({
        type: 'webauthn.get',
        challenge: options.challenge,
        origin,
        crossOrigin: false,
      }),
    );
    const signer = tamper.signWith ?? this;
    const raw = new Uint8Array(
      await subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        signer.keys.privateKey,
        concat(authData, sha256(clientData)),
      ),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key' as const,
      response: {
        clientDataJSON: b64u(clientData),
        authenticatorData: b64u(authData),
        signature: b64u(derSignature(raw)),
        userHandle: b64u(new Uint8Array(Buffer.from(userId.replaceAll('-', ''), 'hex'))),
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform' as const,
    };
  }
}
