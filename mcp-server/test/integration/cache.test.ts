import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import * as cacheEntries from "../../src/db/cache-entries.js";
import { pool } from "../../src/db/pool.js";
import { executeCachedCall } from "../../src/cache/index.js";
import { maybeEvict } from "../../src/cache/eviction.js";
import { startTestDownstreamServer, type TestDownstreamServer } from "../helpers/downstream-server.js";

describe("cache: executeCachedCall", () => {
  let downstream: TestDownstreamServer;

  beforeAll(async () => {
    downstream = await startTestDownstreamServer(4401);
  });

  afterAll(async () => {
    await downstream.close();
    await pool.end();
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM cache_entries WHERE tool_name LIKE 'vitest_%'`);
    await pool.query(`DELETE FROM cache_logs WHERE tool_name LIKE 'vitest_%'`);
  });

  it("misses then hits on an identical call", async () => {
    const args = { key: "vitest-hit-miss" };
    const first = await executeCachedCall({
      endpoint: downstream.url,
      toolName: "vitest_hit_miss",
      arguments: args,
      importance: 3,
    });
    expect(first.cacheHit).toBe(false);
    expect(first.tokensSaved).toBe(0);

    const second = await executeCachedCall({
      endpoint: downstream.url,
      toolName: "vitest_hit_miss",
      arguments: args,
      importance: 3,
    });
    expect(second.cacheHit).toBe(true);
    expect(second.stale).toBe(false);
    expect(second.result).toEqual(first.result);
    // similarity now holds the stage-2 cross-encoder score (sigmoid, [0,1]),
    // not raw cosine — an exact-duplicate call should score far above the
    // default CACHE_RERANK_THRESHOLD (0.6).
    expect(second.similarity ?? 0).toBeGreaterThanOrEqual(0.6);
    expect(second.tokensSaved).toBeGreaterThan(0);
  });

  it("rejects a structurally-similar but semantically different call after reranking", async () => {
    // Regression check for the false-positive risk documented in CLAUDE.md:
    // tool_name + JSON args that differ only in a numeric field (e.g.
    // {"sides":6} vs {"sides":100}) can look deceptively close under cosine
    // similarity alone. The cross-encoder reranker should still tell them
    // apart and reject the mismatch as a miss.
    await executeCachedCall({
      endpoint: downstream.url,
      toolName: "vitest_rerank_discrim",
      arguments: { sides: 6 },
      importance: 3,
    });

    const second = await executeCachedCall({
      endpoint: downstream.url,
      toolName: "vitest_rerank_discrim",
      arguments: { sides: 100 },
      importance: 3,
    });
    expect(second.cacheHit).toBe(false);
  });

  it("calls downstream exactly once for concurrent calls on a new key (stampede guard)", async () => {
    const args = { key: "vitest-stampede" };
    const before = downstream.callCount();

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        executeCachedCall({
          endpoint: downstream.url,
          toolName: "vitest_stampede",
          arguments: args,
          importance: 3,
        }),
      ),
    );

    expect(downstream.callCount() - before).toBe(1);
    // JSONB doesn't preserve object key order on round-trip, so compare
    // structurally (toEqual) rather than by stringified equality.
    for (const r of results) {
      expect(r.result).toEqual(results[0].result);
    }
  });

  it("serves a stale entry when the origin is unreachable", async () => {
    const args = { key: "vitest-stale" };
    const fresh = await executeCachedCall({
      endpoint: downstream.url,
      toolName: "vitest_stale",
      arguments: args,
      importance: 1,
    });
    expect(fresh.cacheHit).toBe(false);

    await pool.query(
      `UPDATE cache_entries SET expires_at = now() - interval '1 minute' WHERE tool_name = 'vitest_stale'`,
    );

    const result = await executeCachedCall({
      endpoint: "http://localhost:9999/mcp",
      toolName: "vitest_stale",
      arguments: args,
      importance: 1,
    });
    expect(result.cacheHit).toBe(true);
    expect(result.stale).toBe(true);
    expect(result.result).toEqual(fresh.result);
  });

  it("evicts lowest-priority entries first once over CACHE_MAX_ENTRIES", async () => {
    // maybeEvict() counts the whole table (proposal 6.1: a global cap, not
    // per-tool), so this test needs a fully clean table for a deterministic count.
    await pool.query(`DELETE FROM cache_entries`);

    await cacheEntries.insertEntry({
      mcpEndpoint: downstream.url,
      toolName: "vitest_evict",
      argumentsHash: "low",
      argumentsRaw: { i: 1 },
      embedding: null,
      result: { v: 1 },
      resultTokens: 1,
      importance: 1,
      expiresAt: new Date(Date.now() + 3600_000),
    });
    await pool.query(
      `UPDATE cache_entries SET last_accessed = now() - interval '30 days' WHERE arguments_hash = 'low'`,
    );

    await cacheEntries.insertEntry({
      mcpEndpoint: downstream.url,
      toolName: "vitest_evict",
      argumentsHash: "high",
      argumentsRaw: { i: 2 },
      embedding: null,
      result: { v: 2 },
      resultTokens: 1,
      importance: 5,
      expiresAt: new Date(Date.now() + 3600_000),
    });
    await pool.query(`UPDATE cache_entries SET hit_count = 50 WHERE arguments_hash = 'high'`);

    await cacheEntries.insertEntry({
      mcpEndpoint: downstream.url,
      toolName: "vitest_evict",
      argumentsHash: "mid",
      argumentsRaw: { i: 3 },
      embedding: null,
      result: { v: 3 },
      resultTokens: 1,
      importance: 3,
      expiresAt: new Date(Date.now() + 3600_000),
    });

    const originalMax = process.env.CACHE_MAX_ENTRIES;
    process.env.CACHE_MAX_ENTRIES = "2";
    await maybeEvict();
    process.env.CACHE_MAX_ENTRIES = originalMax;

    const survivor = await cacheEntries.findByHash("vitest_evict", "high", { freshOnly: false });
    const victim = await cacheEntries.findByHash("vitest_evict", "low", { freshOnly: false });
    expect(survivor).not.toBeNull();
    expect(victim).toBeNull();
  });
});
