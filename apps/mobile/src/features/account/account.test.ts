import type { AccountExport } from '@bargu/schemas';

import { DEFAULT_SHARING } from '../location/sharing';
import { hasHistoryConsent, needsNotice } from './account-api';
import { exportFile, exportName, trailWindow } from './export';

jest.mock('expo-file-system', () => ({ Directory: { pickDirectoryAsync: jest.fn() } }));
jest.mock('../auth/auth-store', () => ({ api: { authed: jest.fn() } }));

const NOW = Date.UTC(2026, 9, 15, 12, 0);
const server: AccountExport = {
  account: {
    userId: '0190f7a4-5b6c-7d8e-9f01-23456789abcd',
    username: 'ayse',
    displayName: 'Ayşe',
    avatar: null,
    createdAt: NOW - 1000,
  },
  devices: [],
  circles: [],
  securityEvents: [{ type: 'login_otp', at: NOW - 500 }],
  passkeys: 0,
  pushRegistered: true,
  historyPieces: 3,
  privacy: { notice: { version: 1, at: NOW - 400 }, history: null },
};

describe('KVKK records on the phone (docs/ADR/0022)', () => {
  it('shows the notice until this version was read, and takes history only with consent', () => {
    expect(needsNotice({ notice: null, history: null })).toBe(true);
    // Version 2 (messages and photos, docs/ADR/0035): whoever read version 1 reads it again.
    expect(needsNotice({ notice: { version: 1, at: 1 }, history: null })).toBe(true);
    expect(needsNotice({ notice: { version: 2, at: 1 }, history: null })).toBe(false);
    expect(hasHistoryConsent({ notice: null, history: null })).toBe(false);
    expect(hasHistoryConsent({ notice: null, history: { version: 1, at: 1 } })).toBe(true);
  });
});

describe('"Verilerimi indir" (docs/ADR/0022)', () => {
  it("puts the server's part and what this phone opened in one file, its own trail included", () => {
    const file = exportFile(
      server,
      {
        sharing: DEFAULT_SHARING,
        places: [
          {
            id: 'p',
            circleId: 'c',
            version: 2,
            name: 'Ev',
            emoji: '🏠',
            lat: 41,
            lng: 29,
            radius: 100,
            ts: 1,
          },
        ],
        docs: [],
        myTrail: [{ at: NOW - 60_000, lat: 41.01, lng: 29.02, acc: 8 }],
        status: null,
      },
      NOW,
      { band: '15-17', method: 'declared', at: NOW - 100 },
      [
        {
          id: '0190f7a4-5b6c-7d8e-9f01-23456789abce',
          role: 'child',
          status: 'active',
          other: { username: 'anne', displayName: 'Anne', avatar: null },
          createdAt: NOW - 50,
          activeAt: NOW - 40,
          endRequestedAt: null,
          endsAt: null,
        },
      ],
      { findable: false, locked: true },
    );
    expect(file).toMatchObject({
      ageBand: { band: '15-17', method: 'declared' },
      findableByUsername: false,
      guardianLinks: [{ role: 'child', status: 'active', other: 'anne', endRequestedAt: null }],
      format: 'bargu-export',
      version: 1,
      account: { username: 'ayse' },
      locationHistoryPiecesOnServer: 3,
      onThisPhone: {
        places: [{ id: 'p', name: 'Ev', lat: 41, lng: 29 }],
        myLocationHistory: [{ lat: 41.01, lng: 29.02, accuracyM: 8 }],
      },
    });
    expect(exportName(NOW)).toBe('bargu-verilerim-2026-10-15.json');
    expect(trailWindow(NOW).to).toBe(NOW);
  });
});
