import { defineServer } from "@airmcp-dev/core";

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
});

await server.start();
