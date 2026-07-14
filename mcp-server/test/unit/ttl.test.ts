import { afterEach, describe, expect, it } from "vitest";

import { computeExpiresAt, ttlSecondsForImportance } from "../../src/cache/ttl.js";

describe("ttlSecondsForImportance", () => {
  afterEach(() => {
    for (let level = 1; level <= 5; level++) {
      delete process.env[`CACHE_TTL_IMPORTANCE_${level}`];
    }
  });

  it("maps the default importance levels to the proposal's TTLs", () => {
    expect(ttlSecondsForImportance(1)).toBe(300);
    expect(ttlSecondsForImportance(2)).toBe(1800);
    expect(ttlSecondsForImportance(3)).toBe(7200);
    expect(ttlSecondsForImportance(4)).toBe(86400);
    expect(ttlSecondsForImportance(5)).toBe(172800);
  });

  it("clamps out-of-range importance to [1, 5]", () => {
    expect(ttlSecondsForImportance(0)).toBe(300);
    expect(ttlSecondsForImportance(99)).toBe(172800);
  });

  it("respects a CACHE_TTL_IMPORTANCE_* env override", () => {
    process.env.CACHE_TTL_IMPORTANCE_3 = "42";
    expect(ttlSecondsForImportance(3)).toBe(42);
  });
});

describe("computeExpiresAt", () => {
  it("adds the TTL seconds to the given reference time", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    const expires = computeExpiresAt(1, from);
    expect(expires.getTime() - from.getTime()).toBe(300_000);
  });
});
