import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { pool } from "../../src/db/pool.js";
import { startTestDownstreamServer, type TestDownstreamServer } from "../helpers/downstream-server.js";

// Treats the mcp-server as a black box, exactly as the AI client would:
// connects over SSE to the running docker-compose container and drives all
// 5 tools through the real MCP protocol. Requires `docker compose up` to
// already be running (see CLAUDE.md section 4).
//
// Transport is SSE, not Streamable HTTP: @airmcp-dev/core 0.3.0's http
// transport can only ever initialize one session per process lifetime (a
// second client is permanently rejected with "Server already initialized",
// even after the first session is cleanly terminated) — see CLAUDE.md
// section 5 "known framework limitation". SSE mode creates a fresh McpServer
// per session and doesn't have this problem.
const MCP_SERVER_URL = process.env.MCP_SERVER_TEST_URL ?? "http://localhost:3000/sse";

function textOf(result: CallToolResult): any {
  const first = result.content[0];
  if (!first || first.type !== "text") {
    throw new Error(`Expected text content, got: ${JSON.stringify(result)}`);
  }
  return JSON.parse(first.text);
}

describe("tools: end-to-end via the running mcp-server", () => {
  let client: Client;
  let downstream: TestDownstreamServer;

  beforeAll(async () => {
    downstream = await startTestDownstreamServer(4403);
    client = new Client({ name: "vitest-e2e", version: "0.0.1" });
    await client.connect(new SSEClientTransport(new URL(MCP_SERVER_URL)));
  });

  afterAll(async () => {
    await client.close();
    await downstream.close();
    await pool.query(`DELETE FROM mcp_registry WHERE alias = 'vitest_downstream'`);
    await pool.query(`DELETE FROM cache_entries WHERE tool_name = 'echo'`);
    await pool.query(`DELETE FROM cache_logs WHERE tool_name = 'echo'`);
    await pool.end();
  });

  it("exposes all 5 tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["cache_clear", "cache_config", "cache_stats", "cached_call", "register_mcp"].sort(),
    );
  });

  it("registers an alias, then caches a call made through it", async () => {
    // downstream.url is host-side (localhost:4403); the containerized
    // mcp-server must reach it via host.docker.internal instead.
    const containerVisibleUrl = downstream.url.replace("localhost", "host.docker.internal");

    const registered = textOf(
      (await client.callTool({
        name: "register_mcp",
        arguments: { alias: "vitest_downstream", endpoint: containerVisibleUrl },
      })) as CallToolResult,
    );
    expect(registered.alias).toBe("vitest_downstream");

    const args = JSON.stringify({ key: "vitest-tools-e2e" });
    const miss = textOf(
      (await client.callTool({
        name: "cached_call",
        arguments: { endpoint: "vitest_downstream", tool_name: "echo", arguments: args, importance: 3 },
      })) as CallToolResult,
    );
    expect(miss.cache_hit).toBe(false);

    const hit = textOf(
      (await client.callTool({
        name: "cached_call",
        arguments: { endpoint: "vitest_downstream", tool_name: "echo", arguments: args, importance: 3 },
      })) as CallToolResult,
    );
    expect(hit.cache_hit).toBe(true);
  });

  it("reports stats reflecting the calls above", async () => {
    const stats = textOf(
      (await client.callTool({ name: "cache_stats", arguments: {} })) as CallToolResult,
    );
    expect(stats.total_hits).toBeGreaterThanOrEqual(1);
  });

  it("updates config at runtime and it takes effect immediately", async () => {
    const config = textOf(
      (await client.callTool({
        name: "cache_config",
        arguments: { similarity_threshold: 0.95 },
      })) as CallToolResult,
    );
    expect(config.similarity_threshold).toBe(0.95);

    // reset so it doesn't leak into other test runs against the same server
    await client.callTool({ name: "cache_config", arguments: { similarity_threshold: 0.9 } });
  });

  it("clears the cache scoped to a bare tool name", async () => {
    const cleared = textOf(
      (await client.callTool({
        name: "cache_clear",
        arguments: { target: "echo" },
      })) as CallToolResult,
    );
    expect(cleared.scope).toBe("tool_name");
    expect(cleared.cleared).toBeGreaterThanOrEqual(1);
  });
});
