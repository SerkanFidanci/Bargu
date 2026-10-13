import { describe, expect, it } from 'vitest';

import { clientBucket } from './client-ip.js';

describe('clientBucket', () => {
  it('keeps IPv4 addresses, including IPv4-mapped IPv6', () => {
    expect(clientBucket('203.0.113.7')).toBe('203.0.113.7');
    expect(clientBucket('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('groups IPv6 addresses by /64, however they are written', () => {
    const bucket = '2001:0db8:0001:0002::/64';
    expect(clientBucket('2001:db8:1:2::1')).toBe(bucket);
    expect(clientBucket('2001:db8:1:2:ffff:ffff:ffff:ffff')).toBe(bucket);
    expect(clientBucket('2001:DB8:1:2:0:0:0:9')).toBe(bucket);
    expect(clientBucket('2001:db8:1:2::1%eth0')).toBe(bucket);
    expect(clientBucket('2001:db8:1:3::1')).not.toBe(bucket);
    expect(clientBucket('::1')).toBe('0000:0000:0000:0000::/64');
    expect(clientBucket('2001:db8::')).toBe('2001:0db8:0000:0000::/64');
  });
});
