import { inviteTokenFrom } from '../circles/invite-link';
import { guardianTokenFrom } from './guardian-link';

const TOKEN = 'A'.repeat(42) + 'b';

describe('guardianTokenFrom (docs/ADR/0023 §4)', () => {
  it("reads the token of a child's guardian code, and only that", () => {
    expect(guardianTokenFrom(`bargu://g/${TOKEN}`)).toBe(TOKEN);
    expect(guardianTokenFrom(` bargu://g/${TOKEN}\n`)).toBe(TOKEN);
    for (const scanned of [
      '',
      TOKEN,
      `bargu://i/${TOKEN}`,
      `https://evil.example/g/${TOKEN}`,
      `bargu://g/${TOKEN}x`,
      `bargu://g/${TOKEN}/extra`,
    ]) {
      expect(guardianTokenFrom(scanned)).toBeNull();
    }
    // A guardian code is never taken for an invite, nor the other way round.
    expect(inviteTokenFrom(`bargu://g/${TOKEN}`)).toBeNull();
  });
});
