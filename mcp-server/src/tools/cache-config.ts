import { defineTool } from "@airmcp-dev/core";
import { z } from "zod";

import { authParams } from "./auth.js";

const ttlMapSchema = z.record(z.enum(["1", "2", "3", "4", "5"]), z.number().int().positive());

const DEFAULT_TTL_SECONDS: Record<string, number> = {
  "1": 300,
  "2": 1800,
  "3": 7200,
  "4": 86400,
  "5": 172800,
};

function currentTtlMap(): Record<string, number> {
  return Object.fromEntries(
    Object.entries(DEFAULT_TTL_SECONDS).map(([level, fallback]) => [
      level,
      Number(process.env[`CACHE_TTL_IMPORTANCE_${level}`] ?? fallback),
    ]),
  );
}

// These setters mutate process.env directly rather than a separate config
// store, because cache/ttl.ts, cache/eviction.ts and cache/cached-call.ts
// already re-read process.env on every call (not at module load) — so the
// change takes effect immediately, no process restart needed.
export const cacheConfigTool = defineTool("cache_config", {
  description:
    "캐시 동작 설정(최대 항목 수, 유사도/재랭킹 임계값, 중요도별 TTL)을 변경합니다.",
  params: {
    max_entries: z.number().int().positive().optional().describe("최대 캐시 항목 수 (기본 50,000)"),
    similarity_threshold: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe(
        "1단계 코사인 유사도 임계값 (기본 0.90). 재랭킹 서비스 장애 시 폴백 판정에만 사용됨 — 평상시 히트/미스는 rerank_threshold가 결정",
      ),
    rerank_threshold: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("2단계 cross-encoder 재랭킹 점수 임계값 (기본 0.60) — 평상시 히트/미스를 실제로 결정하는 값"),
    ttl_map: z
      .string()
      .optional()
      .describe('중요도별 TTL(초) JSON, 예: {"1":300,"2":1800,"3":7200,"4":86400,"5":172800}'),
    ...authParams,
  },
  handler: async ({ max_entries, similarity_threshold, rerank_threshold, ttl_map }) => {
    if (max_entries !== undefined) {
      process.env.CACHE_MAX_ENTRIES = String(max_entries);
    }
    if (similarity_threshold !== undefined) {
      process.env.CACHE_SIMILARITY_THRESHOLD = String(similarity_threshold);
    }
    if (rerank_threshold !== undefined) {
      process.env.CACHE_RERANK_THRESHOLD = String(rerank_threshold);
    }
    if (ttl_map !== undefined) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(ttl_map);
      } catch {
        throw new Error(
          `"ttl_map" must be valid JSON, e.g. {"1":300,"2":1800,"3":7200,"4":86400,"5":172800}`,
        );
      }
      const validated = ttlMapSchema.parse(parsed);
      for (const [level, seconds] of Object.entries(validated)) {
        process.env[`CACHE_TTL_IMPORTANCE_${level}`] = String(seconds);
      }
    }

    return {
      max_entries: Number(process.env.CACHE_MAX_ENTRIES ?? 50000),
      similarity_threshold: Number(process.env.CACHE_SIMILARITY_THRESHOLD ?? 0.9),
      rerank_threshold: Number(process.env.CACHE_RERANK_THRESHOLD ?? 0.6),
      ttl_map: currentTtlMap(),
    };
  },
});
