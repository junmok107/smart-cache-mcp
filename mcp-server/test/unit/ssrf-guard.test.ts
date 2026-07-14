import { afterEach, describe, expect, it } from "vitest";

import {
  assertPublicEndpoint,
  isPrivateOrLoopbackIPv4,
  isPrivateOrLoopbackIPv6,
} from "../../src/tools/ssrf-guard.js";

describe("isPrivateOrLoopbackIPv4", () => {
  it("flags loopback, private, and link-local ranges", () => {
    expect(isPrivateOrLoopbackIPv4("127.0.0.1")).toBe(true);
    expect(isPrivateOrLoopbackIPv4("10.1.2.3")).toBe(true);
    expect(isPrivateOrLoopbackIPv4("172.16.0.5")).toBe(true);
    expect(isPrivateOrLoopbackIPv4("172.31.255.255")).toBe(true);
    expect(isPrivateOrLoopbackIPv4("192.168.1.1")).toBe(true);
    expect(isPrivateOrLoopbackIPv4("169.254.169.254")).toBe(true); // cloud metadata
  });

  it("does not flag public addresses", () => {
    expect(isPrivateOrLoopbackIPv4("8.8.8.8")).toBe(false);
    expect(isPrivateOrLoopbackIPv4("172.32.0.1")).toBe(false); // just outside 172.16.0.0/12
    expect(isPrivateOrLoopbackIPv4("1.1.1.1")).toBe(false);
  });
});

describe("isPrivateOrLoopbackIPv6", () => {
  it("flags loopback, unique-local, and link-local ranges", () => {
    expect(isPrivateOrLoopbackIPv6("::1")).toBe(true);
    expect(isPrivateOrLoopbackIPv6("fd12:3456::1")).toBe(true);
    expect(isPrivateOrLoopbackIPv6("fe80::1")).toBe(true);
  });

  it("does not flag public addresses", () => {
    expect(isPrivateOrLoopbackIPv6("2001:4860:4860::8888")).toBe(false);
  });
});

describe("assertPublicEndpoint", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("allows private endpoints outside production (dev/test convenience)", async () => {
    process.env.NODE_ENV = "development";
    await expect(assertPublicEndpoint("http://host.docker.internal:4500/mcp")).resolves.toBeUndefined();
    await expect(assertPublicEndpoint("http://localhost:4500/mcp")).resolves.toBeUndefined();
  });

  it("rejects localhost by hostname in production without a DNS lookup", async () => {
    process.env.NODE_ENV = "production";
    await expect(assertPublicEndpoint("http://localhost:4500/mcp")).rejects.toThrow(
      /private\/internal endpoint/,
    );
  });
});
