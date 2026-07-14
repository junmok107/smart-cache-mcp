import { defineTool } from "@airmcp-dev/core";
import { z } from "zod";

import { executeCachedCall } from "../cache/index.js";
import { resolveEndpoint } from "./resolve-endpoint.js";

export const cachedCallTool = defineTool("cached_call", {
  description:
    "다른 MCP 서버의 도구를 캐시 프록시를 통해 호출합니다. 캐시 조회, 원본 호출, 결과 저장이 자동으로 처리됩니다.",
  params: {
    endpoint: z.string().describe("원본 MCP 서버 URL 또는 register_mcp로 등록한 별칭"),
    tool_name: z.string().describe("호출할 도구 이름"),
    arguments: z.string().describe("도구 파라미터 (JSON 문자열)"),
    importance: z
      .number()
      .int()
      .min(1)
      .max(5)
      .describe("1(매우 낮음)~5(매우 높음) 데이터 중요도 — 캐시 TTL을 결정"),
  },
  handler: async ({ endpoint, tool_name, arguments: argumentsJson, importance }) => {
    let parsedArguments: Record<string, unknown>;
    try {
      parsedArguments = JSON.parse(argumentsJson);
    } catch {
      throw new Error(`"arguments" must be a valid JSON string, got: ${argumentsJson}`);
    }

    const resolvedEndpoint = await resolveEndpoint(endpoint);

    const result = await executeCachedCall({
      endpoint: resolvedEndpoint,
      toolName: tool_name,
      arguments: parsedArguments,
      importance,
    });

    return {
      result: result.result,
      cache_hit: result.cacheHit,
      similarity: result.similarity,
      tokens_saved: result.tokensSaved,
      stale: result.stale,
    };
  },
});
