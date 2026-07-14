import { afterEach, describe, expect, it, vi } from "vitest";

describe("auth", () => {
  const originalToken = process.env.MCP_AUTH_TOKEN;

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.MCP_AUTH_TOKEN;
    } else {
      process.env.MCP_AUTH_TOKEN = originalToken;
    }
    vi.resetModules();
  });

  it("is disabled and adds no params when MCP_AUTH_TOKEN is unset", async () => {
    delete process.env.MCP_AUTH_TOKEN;
    vi.resetModules();
    const { AUTH_ENABLED, authParams } = await import("../../src/tools/auth.js");
    expect(AUTH_ENABLED).toBe(false);
    expect(authParams).toEqual({});
  });

  it("is enabled and adds an _auth param when MCP_AUTH_TOKEN is set", async () => {
    process.env.MCP_AUTH_TOKEN = "test-token";
    vi.resetModules();
    const { AUTH_ENABLED, authParams } = await import("../../src/tools/auth.js");
    expect(AUTH_ENABLED).toBe(true);
    expect(Object.keys(authParams)).toEqual(["_auth"]);
  });
});
