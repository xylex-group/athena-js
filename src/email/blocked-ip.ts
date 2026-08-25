/**
 * Attachment SSRF: block IPv4 addresses that IANA does not classify as
 * globally reachable (RFC 6890 Special-Purpose Address Registry).
 *
 * Allowlisting “private + loopback + multicast” is not enough: documentation
 * prefixes such as 203.0.113.0/24 (TEST-NET-3) are omitted by that subset and
 * are still routed in some environments.
 */

export function parseIpv4(value: string): [number, number, number, number] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (!match) {
    return null;
  }
  const octets = match.slice(1).map(Number) as [number, number, number, number];
  if (octets.some((octet) => octet > 255)) {
    return null;
  }
  return octets;
}

export function isBlockedIpv4(octets: [number, number, number, number]): boolean {
  const [a, b, c, d] = octets;
  if (a === 0 || a === 10 || a === 127) {
    return true;
  }
  // 100.64.0.0/10 shared address space (CGNAT).
  if (a === 100 && (b & 0xc0) === 64) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  // 172.16.0.0/12 private.
  if (a === 172 && (b & 0xf0) === 16) {
    return true;
  }
  // 192.0.0.0/24 IETF Protocol Assignments. 192.0.0.9 / .10 are globally reachable anycast.
  if (a === 192 && b === 0 && c === 0 && d !== 9 && d !== 10) {
    return true;
  }
  // 192.0.2.0/24 TEST-NET-1.
  if (a === 192 && b === 0 && c === 2) {
    return true;
  }
  // 192.88.99.0/24 6to4 relay anycast (deprecated; not globally reachable).
  if (a === 192 && b === 88 && c === 99) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  // 198.18.0.0/15 benchmarking.
  if (a === 198 && (b & 0xfe) === 18) {
    return true;
  }
  // 198.51.100.0/24 TEST-NET-2.
  if (a === 198 && b === 51 && c === 100) {
    return true;
  }
  // 203.0.113.0/24 TEST-NET-3.
  if (a === 203 && b === 0 && c === 113) {
    return true;
  }
  // 224.0.0.0/4 multicast and 240.0.0.0/4 reserved.
  if (a >= 224) {
    return true;
  }
  return false;
}
