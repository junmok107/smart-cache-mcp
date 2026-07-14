import { defineTool } from "@airmcp-dev/core";
import { z } from "zod";

import { cacheEntries, mcpRegistry } from "../db/index.js";
import { authParams } from "./auth.js";

export const cacheClearTool = defineTool("cache_clear", {
  description:
    '캐시를 삭제합니다. target="all"이면 전체, 등록된 MCP 별칭이면 해당 MCP 서버의 캐시만, 그 외 값이면 도구 이름으로 간주해 해당 도구의 캐시만 삭제합니다.',
  params: {
    target: z.string().describe('"all" / MCP 별칭 / 도구 이름'),
    ...authParams,
  },
  handler: async ({ target }) => {
    if (target === "all") {
      const cleared = await cacheEntries.deleteAll();
      return { scope: "all", cleared };
    }

    const alias = await mcpRegistry.findByAlias(target);
    if (alias) {
      const cleared = await cacheEntries.deleteByEndpoint(alias.endpoint);
      return { scope: "mcp_alias", alias: target, endpoint: alias.endpoint, cleared };
    }

    const cleared = await cacheEntries.deleteByToolName(target);
    return { scope: "tool_name", tool_name: target, cleared };
  },
});
