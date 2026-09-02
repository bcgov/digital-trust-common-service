import { lookup } from 'node:dns/promises';
import { isIP, isIPv4, isIPv6 } from 'node:net';

import { UnprocessableEntityException } from '@nestjs/common';
import { Address4, Address6 } from 'ip-address';

/**
 * Guards outbound connector requests against SSRF.
 *
 * `endpointUrl` is tenant-supplied and used by `ConnectorHealthCheckService`
 * to make server-side HTTP requests. Without this check a tenant could point
 * it at internal infrastructure (a cloud metadata service, a
 * cluster-internal host, loopback) and use the server as an SSRF proxy.
 *
 * Re-resolves DNS on every call rather than trusting a prior validation,
 * since a hostname's resolution can change between requests. This narrows
 * — but does not eliminate — a DNS-rebinding window between this check and
 * the `fetch()` call that follows it, since `fetch()` performs its own,
 * separate resolution.
 */
export async function assertSafeConnectorUrl(rawUrl: string): Promise<void> {
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnprocessableEntityException(
      'Connector endpoint URL is not a valid URL.',
    );
  }

  if (url.protocol !== 'https:') {
    throw new UnprocessableEntityException(
      'Connector endpoint URL must use https.',
    );
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(hostname)
    ? [hostname]
    : await resolveHostnameAddresses(hostname);

  if (addresses.length === 0) {
    throw new UnprocessableEntityException(
      'Connector endpoint hostname could not be resolved.',
    );
  }

  if (addresses.some((address) => isDisallowedAddress(address))) {
    throw new UnprocessableEntityException(
      'Connector endpoint resolves to a private, loopback, or reserved network address.',
    );
  }
}

async function resolveHostnameAddresses(hostname: string): Promise<string[]> {
  try {
    const results = await lookup(hostname, { all: true, verbatim: true });
    return results.map((result) => result.address);
  } catch {
    throw new UnprocessableEntityException(
      'Connector endpoint hostname could not be resolved.',
    );
  }
}

function isDisallowedAddress(address: string): boolean {
  if (isIPv4(address)) {
    return isDisallowedIPv4(new Address4(address));
  }

  if (isIPv6(address)) {
    return isDisallowedIPv6(new Address6(address));
  }

  // Unrecognized address family — fail closed.
  return true;
}

// Special-purpose IPv4 ranges not already covered by Address4's built-in
// classifiers (isPrivate, isLoopback, isLinkLocal, isUnspecified,
// isBroadcast, isMulticast, isCGNAT).
const IPV4_DISALLOWED_SUBNETS = [
  '0.0.0.0/8', // "this" network
  '192.0.0.0/24', // IETF protocol assignments
  '192.0.2.0/24', // TEST-NET-1
  '198.18.0.0/15', // benchmarking
  '198.51.100.0/24', // TEST-NET-2
  '203.0.113.0/24', // TEST-NET-3
  '240.0.0.0/4', // reserved for future use
].map((cidr) => new Address4(cidr));

function isDisallowedIPv4(address: Address4): boolean {
  return (
    address.isPrivate() || // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
    address.isLoopback() || // 127.0.0.0/8
    address.isLinkLocal() || // 169.254.0.0/16 (incl. cloud metadata)
    address.isUnspecified() || // 0.0.0.0
    address.isBroadcast() || // 255.255.255.255
    address.isMulticast() || // 224.0.0.0/4
    address.isCGNAT() || // 100.64.0.0/10
    IPV4_DISALLOWED_SUBNETS.some((subnet) => address.isHostInSubnet(subnet))
  );
}

function isDisallowedIPv6(address: Address6): boolean {
  // isPrivate/isLoopback/isLinkLocal/isMulticast/isUnspecified/isBroadcast/
  // isCGNAT already normalize through any embedded IPv4 address (e.g.
  // ::ffff:10.0.0.1, 64:ff9b::7f00:1), so no separate v4-in-v6 handling is
  // needed here.
  return (
    address.isLoopback() || // ::1
    address.isUnspecified() || // ::
    address.isLinkLocal() || // fe80::/10
    address.isMulticast() || // ff00::/8
    address.isPrivate() || // fc00::/7 unique local
    address.isCGNAT() ||
    address.isBroadcast() ||
    address.isDocumentation() // 2001:db8::/32
  );
}
