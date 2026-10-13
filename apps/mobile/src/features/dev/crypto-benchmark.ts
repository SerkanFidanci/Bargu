import {
  applyPrecision,
  createSenderKeyDistribution,
  createSenderState,
  decryptMessage,
  encryptMessage,
  generateDeviceKeys,
  generateSenderKey,
  ReplayGuard,
  safetyNumber,
  sealForDevice,
  type DevicePublicKeys,
} from '@bargu/crypto';
import type { LocPayload } from '@bargu/schemas';

/** Faz 1 DoD: encrypting a location on the device takes < 5 ms. */
export const ENCRYPT_BUDGET_MS = 5;

export interface BenchmarkResult {
  readonly id: 'encrypt' | 'send' | 'decrypt' | 'distribute' | 'seal' | 'keygen' | 'safetyNumber';
  readonly iterations: number;
  readonly medianMs: number;
  readonly p95Ms: number;
}

// Fixed, benchmark-only identifiers.
const CIRCLE = '0190f7a4-5b6c-7d8e-9f01-23456789abcd';
const ALICE_DEVICE = '0190f7a4-0000-7000-8000-00000000a11c';
const BOB_DEVICE = '0190f7a4-0000-7000-8000-000000000b0b';

function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
}

const WARM_UP_CALLS = 5;

/**
 * Times `run` over warm-up plus `iterations` calls. `call` keeps counting across both phases, so an
 * operation that must not repeat (decrypting the same envelope twice is a replay) gets fresh input.
 */
function measure(
  id: BenchmarkResult['id'],
  iterations: number,
  run: (call: number) => void,
): BenchmarkResult {
  let call = 0;
  for (; call < WARM_UP_CALLS; call++) run(call); // warm caches before timing
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++, call++) {
    const start = performance.now();
    run(call);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return { id, iterations, medianMs: percentile(samples, 0.5), p95Ms: percentile(samples, 0.95) };
}

/**
 * Runs the protocol's hot paths on this device with the same code the app ships. `scale` shrinks
 * the iteration counts (tests use a small value).
 */
export function runCryptoBenchmark(scale = 1): BenchmarkResult[] {
  const n = (count: number) => Math.max(1, Math.round(count * scale));
  const alice = generateDeviceKeys(ALICE_DEVICE);
  const bob = generateDeviceKeys(BOB_DEVICE);
  const alicePublic: DevicePublicKeys = {
    deviceId: alice.deviceId,
    identityKey: alice.identity.publicKey,
    dhKey: alice.dh.publicKey,
  };
  const bobPublic: DevicePublicKeys = {
    deviceId: bob.deviceId,
    identityKey: bob.identity.publicKey,
    dhKey: bob.dh.publicKey,
  };
  const senderKey = generateSenderKey({ circleId: CIRCLE, epoch: 1, senderDeviceId: ALICE_DEVICE });
  const location: LocPayload = {
    kind: 'loc',
    lat: 41.0082,
    lng: 28.9784,
    acc: 8,
    spd: 1.2,
    hdg: 90,
    bat: 64,
    chg: false,
    ts: Date.now(),
  };

  let state = createSenderState(senderKey);
  const encryptOnce = (payload: LocPayload) => {
    const result = encryptMessage({ state, sender: alice, payload });
    state = result.nextState;
    return result.envelope;
  };
  const decryptRuns = n(200);
  // One envelope per decrypt call: each is accepted exactly once by the replay guard.
  const envelopes = Array.from({ length: WARM_UP_CALLS + decryptRuns }, () =>
    encryptOnce(location),
  );
  const replay = new ReplayGuard();

  return [
    measure('encrypt', n(200), () => encryptOnce(location)),
    measure('send', n(200), () => encryptOnce(applyPrecision(location, 'neighborhood'))),
    measure('decrypt', decryptRuns, (call) => {
      decryptMessage({ envelope: envelopes[call], senderKey, sender: alicePublic, replay });
    }),
    measure('distribute', n(100), () => {
      createSenderKeyDistribution({ senderKey, sender: alice, recipient: bobPublic });
    }),
    measure('seal', n(100), () => sealForDevice(bob.dh.publicKey, new Uint8Array(300))),
    measure('keygen', n(50), (call) =>
      generateDeviceKeys(call % 2 === 0 ? ALICE_DEVICE : BOB_DEVICE),
    ),
    measure('safetyNumber', n(10), () =>
      safetyNumber(
        { userId: CIRCLE, identityKey: alice.identity.publicKey },
        { userId: BOB_DEVICE, identityKey: bob.identity.publicKey },
      ),
    ),
  ];
}
