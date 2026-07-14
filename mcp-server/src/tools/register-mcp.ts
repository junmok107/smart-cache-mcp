import { defineTool } from "@airmcp-dev/core";
import { z } from "zod";

import { mcpRegistry } from "../db/index.js";
import { assertPublicEndpoint } from "./ssrf-guard.js";

const URL_PATTERN = /^https?:\/\//i;

export const registerMcpTool = defineTool("register_mcp", {
  description:
    "자주 호출하는 MCP 서버를 별칭으로 등록합니다. 등록 후 cached_call에서 endpoint 대신 별칭을 사용할 수 있습니다.",
  params: {
    alias: z.string().min(1).describe('별칭 (예: "weather", "sq")'),
    endpoint: z.string().describe("MCP 서버 URL"),
  },
  handler: async ({ alias, endpoint }) => {
    if (!URL_PATTERN.test(endpoint)) {
      throw new Error(`"endpoint" must be a valid http(s):// URL, got: ${endpoint}`);
    }
    await assertPublicEndpoint(endpoint);
    const row = await mcpRegistry.upsertAlias(alias, endpoint);
    return { alias: row.alias, endpoint: row.endpoint, registered_at: row.created_at };
  },
});
