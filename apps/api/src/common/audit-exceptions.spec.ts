import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Audit exceptions with an end (pnpm-workspace.yaml `audit.ignore`): past it, CI asks again. The PM,
 * 2026-10-29: decode-uri-component until Expo SDK 58 or 2026-12-31, whichever comes first.
 */
const DEADLINES: Readonly<Record<string, string>> = {
  'GHSA-qr28-fpjm-wq7f': '2026-12-31T23:59:59Z',
};

// Tests run in apps/api (turbo, CI): the workspace file is two levels up.
const workspace = readFileSync('../../pnpm-workspace.yaml', 'utf8');

describe('audit exceptions (pnpm-workspace.yaml)', () => {
  it.each(Object.entries(DEADLINES))(
    '%s is reviewed again by its deadline, %s',
    (advisory, deadline) => {
      if (!workspace.includes(advisory)) return;
      expect(
        Date.now(),
        `${advisory} is still ignored past ${deadline}: check for a fix (Expo SDK 58) and remove it, or review it again`,
      ).toBeLessThan(Date.parse(deadline));
    },
  );
});
