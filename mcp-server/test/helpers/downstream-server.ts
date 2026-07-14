// Shared test fixture: a minimal spec-compliant downstream MCP server (raw
// SDK, no @airmcp-dev/core) that integration tests register/call through
// our proxy and cache layers. Uses the low-level Server class with a
// wildcard CallTool handler (rather than McpServer.registerTool, which
// requires each tool name to be pre-registered) so different tests can each
// call it under whatever tool_name they like. Every call returns a fresh
// random value, so tests can tell a cache hit (same value) apart from a
// fresh call (different value).
import type { Server as HttpServer } from "node:http";

import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

export interface TestDownstreamServer {
  /** Host-reachable URL, e.g. http://localhost:4400/mcp */
  url: string;
  callCount: () => number;
  close: () => Promise<void>;
}

export function startTestDownstreamServer(port: number): Promise<TestDownstreamServer> {
  let callCount = 0;

  function getServer() {
    const server = new Server(
      { name: "test-downstream", version: "0.0.1" },
      { capabilities: { tools: {} } },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [{ name: "echo", description: "Returns a fresh random value each call", inputSchema: { type: "object" } }],
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      callCount += 1;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              tool: request.params.name,
              args: request.params.arguments,
              random: Math.random(),
              call: callCount,
            }),
          },
        ],
      };
    });

    return server;
  }

  // createMcpExpressApp defaults to DNS-rebinding protection that only
  // allows Host: 127.0.0.1/localhost — docker containers reach this fixture
  // via host.docker.internal, so that hostname must be explicitly allowed
  // (as a bare hostname, no port — see hostHeaderValidation).
  const app = createMcpExpressApp({
    allowedHosts: ["localhost", "127.0.0.1", "host.docker.internal"],
  });

  app.post("/mcp", async (req: any, res: any) => {
    const server = getServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("close", () => {
      transport.close();
      server.close();
    });
  });

  return new Promise((resolve) => {
    const httpServer: HttpServer = app.listen(port, () => {
      resolve({
        url: `http://localhost:${port}/mcp`,
        callCount: () => callCount,
        close: () => new Promise<void>((res) => httpServer.close(() => res())),
      });
    });
  });
}
