import { isIPv4, isIPv6 } from 'node:net';

const IPV4_MAPPED_PREFIX = '::ffff:';

/**
 * The unit a rate limit counts: an IPv4 address, or the /64 network of an IPv6 address (one
 * subscriber usually owns a whole /64, so counting single IPv6 addresses would be no limit at all).
 */
export function clientBucket(ip: string): string {
  const address = ip.split('%')[0] ?? ip;
  const mapped = address.toLowerCase().startsWith(IPV4_MAPPED_PREFIX)
    ? address.slice(IPV4_MAPPED_PREFIX.length)
    : undefined;
  if (mapped !== undefined && isIPv4(mapped)) return mapped;
  if (!isIPv6(address)) return address;

  const [head = '', tail] = address.toLowerCase().split('::');
  const left = head === '' ? [] : head.split(':');
  const right = tail === undefined || tail === '' ? [] : tail.split(':');
  const missing = tail === undefined ? 0 : 8 - left.length - right.length;
  const groups = [...left, ...Array<string>(missing).fill('0'), ...right];
  return `${groups
    .slice(0, 4)
    .map((group) => group.padStart(4, '0'))
    .join(':')}::/64`;
}
