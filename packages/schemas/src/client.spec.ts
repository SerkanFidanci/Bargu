import { describe, expect, it } from 'vitest';

import { CLIENT_LEVEL, clientLevelOf } from './index.js';

describe('client level (QA 19 P4)', () => {
  it('reads a whole number and counts anything else as an old app', () => {
    expect(clientLevelOf(String(CLIENT_LEVEL))).toBe(CLIENT_LEVEL);
    expect(clientLevelOf('12')).toBe(12);
    expect(clientLevelOf(['3', '9'])).toBe(3);
    for (const value of [undefined, null, '', '-1', '1.5', 'abc', '99999', 2, {}]) {
      expect(clientLevelOf(value)).toBe(0);
    }
  });
});
