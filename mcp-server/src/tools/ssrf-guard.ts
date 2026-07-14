import { lookup } from "node:dns/promises";

// register_mcp accepts an arbitrary URL, and cached_call later makes a
// server-side request to whatever was registered — a classic SSRF shape if
// this server is ever reachable by untrusted callers. Private/loopback/
// link-local endpoints (host.docker.internal, localhost, 192.168.x.x, the
// 169.254.169.254 cloud metadata address, ...) are legitimate and common in
// local development, so this only enforces in production; NODE_ENV stays
// "development" for local/docker-compose use (see .env.example).
export function isPrivateOrLoopbackIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 127 || // 127.0.0.0/8 loopback
    a === 10 || // 10.0.0.0/8 private
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 private
    (a === 192 && b === 168) || // 192.168.0.0/16 private
    (a === 169 && b === 254) || // 169.254.0.0/16 link-local (incl. cloud metadata)
    a === 0 // 0.0.0.0/8
  );
}

export function isPrivateOrLoopbackIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  return (
    normalized === "::1" || // loopback
    normalized === "::" ||
    normalized.startsWith("fc") || // fc00::/7 unique local
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80") // fe80::/10 link-local
  );
}

export function isPrivateOrLoopbackAddress(ip: string): boolean {
  return isPrivateOrLoopbackIPv4(ip) || isPrivateOrLoopbackIPv6(ip);
}

export class UnsafeEndpointError extends Error {
  constructor(endpoint: string, reason: string) {
    super(`Refusing to register a private/internal endpoint in production: ${endpoint} (${reason})`);
    this.name = "UnsafeEndpointError";
  }
}

export async function assertPublicEndpoint(endpoint: string): Promise<void> {
  if (process.env.NODE_ENV !== "production") {
    return;
  }

  const { hostname } = new URL(endpoint);
  if (hostname === "localhost") {
    throw new UnsafeEndpointError(endpoint, "hostname is localhost");
  }

  let addresses: string[];
  try {
    const results = await lookup(hostname, { all: true });
    addresses = results.map((r) => r.address);
  } catch (error) {
    throw new Error(
      `Could not resolve endpoint hostname "${hostname}": ${(error as Error).message}`,
      { cause: error },
    );
  }

  for (const address of addresses) {
    if (isPrivateOrLoopbackAddress(address)) {
      throw new UnsafeEndpointError(endpoint, `resolved to ${address}`);
    }
  }
}
