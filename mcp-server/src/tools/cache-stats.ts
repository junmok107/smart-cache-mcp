import { defineTool } from "@airmcp-dev/core";

import { cacheEntries, cacheLogs } from "../db/index.js";
import { AUTH_ENABLED, authParams } from "./auth.js";

export const cacheStatsTool = defineTool("cache_stats", {
  description:
    "캐시 사용 현황, 히트율, 절감 토큰 추정치, 도구별/쿼리별 히트 통계를 리포트합니다.",
  // cache_stats otherwise has no params — only attach a schema when auth is
  // on, so the tool's advertised shape is unchanged when it's off.
  ...(AUTH_ENABLED ? { params: { ...authParams } } : {}),
  handler: async () => {
    const [totalEntries, usedBytes, overall, topTools, topEntries] = await Promise.all([
      cacheEntries.countEntries(),
      cacheEntries.totalEntriesSizeBytes(),
      cacheLogs.overallStats(),
      cacheLogs.topToolsByHitRate(5),
      cacheEntries.topHitEntries(5),
    ]);

    return {
      total_entries: totalEntries,
      max_entries: Number(process.env.CACHE_MAX_ENTRIES ?? 50000),
      used_bytes: usedBytes,
      overall_hit_rate: overall.hitRate,
      total_lookups: overall.totalLookups,
      total_hits: overall.totalHits,
      tokens_saved_total: overall.tokensSavedTotal,
      top_tools_by_hit_rate: topTools.map((tool) => ({
        tool_name: tool.toolName,
        hit_rate: tool.hitRate,
        total_lookups: tool.totalLookups,
      })),
      top_hit_entries: topEntries.map((entry) => ({
        tool_name: entry.tool_name,
        arguments: entry.arguments_raw,
        hit_count: entry.hit_count,
      })),
    };
  },
});
