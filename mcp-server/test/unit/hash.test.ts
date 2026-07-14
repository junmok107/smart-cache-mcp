import { describe, expect, it } from "vitest";

import { advisoryLockKey, buildCacheText, hashArguments } from "../../src/cache/hash.js";

describe("hashArguments", () => {
  it("is deterministic regardless of key order", () => {
    const a = hashArguments({ city: "Seoul", country: "KR" });
    const b = hashArguments({ country: "KR", city: "Seoul" });
    expect(a).toBe(b);
  });

  it("differs for different arguments", () => {
    const a = hashArguments({ city: "Seoul" });
    const b = hashArguments({ city: "Busan" });
    expect(a).not.toBe(b);
  });
});

describe("buildCacheText", () => {
  it("combines the tool name and canonicalized arguments", () => {
    const text = buildCacheText("get_weather", { city: "Seoul" });
    expect(text).toContain("get_weather");
    expect(text).toContain("Seoul");
  });

  it("is insensitive to argument key order", () => {
    const a = buildCacheText("t", { a: 1, b: 2 });
    const b = buildCacheText("t", { b: 2, a: 1 });
    expect(a).toBe(b);
  });
});

describe("advisoryLockKey", () => {
  it("is deterministic for the same inputs", () => {
    const a = advisoryLockKey("tool", "hash1");
    const b = advisoryLockKey("tool", "hash1");
    expect(a).toBe(b);
  });

  it("differs across tool names for the same argument hash", () => {
    const a = advisoryLockKey("toolA", "hash1");
    const b = advisoryLockKey("toolB", "hash1");
    expect(a).not.toBe(b);
  });
});
