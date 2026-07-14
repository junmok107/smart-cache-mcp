import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Simulates an embedding-service outage (proposal 8.2) deterministically via
// vi.mock, instead of actually stopping the docker container — this test
// exercises the real fallback branch in cache/cached-call.ts, not just the
// DB query in isolation.
vi.mock("../../src/embedding/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/embedding/index.js")>();
  const outage = () => Promise.reject(new actual.EmbeddingServiceError("simulated outage"));
  return { ...actual, embedQuery: outage, embedPassage: outage };
});

import { executeCachedCall } from "../../src/cache/index.js";
import { pool } from "../../src/db/pool.js";
import { startTestDownstreamServer, type TestDownstreamServer } from "../helpers/downstream-server.js";

describe("cache: embedding-service outage falls back to hash matching", () => {
  let downstream: TestDownstreamServer;

  beforeAll(async () => {
    downstream = await startTestDownstreamServer(4402);
  });

  afterAll(async () => {
    await downstream.close();
    await pool.end();
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM cache_entries WHERE tool_name = 'vitest_hash_fallback'`);
    await pool.query(`DELETE FROM cache_logs WHERE tool_name = 'vitest_hash_fallback'`);
  });

  it("stores without a vector, then still hits on an identical call via exact hash match", async () => {
    const args = { key: "vitest-hash-fallback" };

    const first = await executeCachedCall({
      endpoint: downstream.url,
      toolName: "vitest_hash_fallback",
      arguments: args,
      importance: 3,
    });
    expect(first.cacheHit).toBe(false);

    const { rows } = await pool.query(
      `SELECT embedding IS NULL AS no_vector FROM cache_entries WHERE tool_name = 'vitest_hash_fallback'`,
    );
    expect(rows[0].no_vector).toBe(true);

    const second = await executeCachedCall({
      endpoint: downstream.url,
      toolName: "vitest_hash_fallback",
      arguments: args,
      importance: 3,
    });
    expect(second.cacheHit).toBe(true);
    expect(second.similarity).toBe(1);
  });
});
