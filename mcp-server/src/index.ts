import { authPlugin, defineServer } from "@airmcp-dev/core";

import { AUTH_ENABLED } from "./tools/auth.js";
import {
  cacheClearTool,
  cacheConfigTool,
  cachedCallTool,
  cacheStatsTool,
  registerMcpTool,
} from "./tools/index.js";

const port = Number(process.env.MCP_SERVER_PORT ?? 3000);

const server = defineServer({
  name: "smart-cache-mcp",
  version: "0.1.0",
  transport: { type: "sse", port },
  tools: [cachedCallTool, registerMcpTool, cacheStatsTool, cacheClearTool, cacheConfigTool],
  // Opt-in bearer-token auth (see src/tools/auth.ts) — off by default so
  // local/single-user development stays zero-config; set MCP_AUTH_TOKEN to
  // require it (e.g. before exposing this server beyond localhost).
  use: AUTH_ENABLED
    ? [authPlugin({ type: "bearer", keys: [process.env.MCP_AUTH_TOKEN as string] })]
    : [],
  // Built-in threat detection (prompt-injection/command-injection/path-
  // traversal patterns in tool params), a global per-tool rate limit, and
  // an audit log of every allow/deny decision. cached_call gets the
  // largest budget since it's the hot path; cache_clear (destructive,
  // wipes data) gets the tightest.
  shield: {
    enabled: true,
    threatDetection: true,
    audit: true,
    rateLimit: {
      windowMs: 60_000,
      maxCalls: 60,
      perTool: {
        cached_call: { maxCalls: 120 },
        cache_stats: { maxCalls: 60 },
        register_mcp: { maxCalls: 20 },
        cache_config: { maxCalls: 20 },
        cache_clear: { maxCalls: 5 },
      },
    },
  },
});

await server.start();
