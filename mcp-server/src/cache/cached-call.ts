import { cacheEntries, cacheLogs } from "../db/index.js";
import type { CacheEntryRow, SimilarityMatch } from "../db/cache-entries.js";
import { EmbeddingServiceError, embedPassage, embedQuery } from "../embedding/index.js";
import { DownstreamMcpError, callDownstreamTool } from "../proxy/index.js";
import { maybeEvict } from "./eviction.js";
import { buildCacheText, hashArguments } from "./hash.js";
import { withStampedeLock } from "./stampede.js";
import { computeExpiresAt } from "./ttl.js";

// Read at call time (not module load) so a future cache_config tool can
// change this at runtime without a process restart.
function getSimilarityThreshold(): number {
  return Number(process.env.CACHE_SIMILARITY_THRESHOLD ?? 0.9);
}

export interface CachedCallParams {
  /** Already-resolved downstream MCP server URL (alias resolution happens
   *  one layer up, in the cached_call tool handler). */
  endpoint: string;
  toolName: string;
  arguments: Record<string, unknown>;
  /** 1 (very low) .. 5 (very high) — drives TTL, see cache/ttl.ts */
  importance: number;
}

export interface CachedCallResult {
  result: unknown;
  cacheHit: boolean;
  similarity: number | null;
  tokensSaved: number;
  stale: boolean;
}

function estimateTokens(value: unknown): number {
  // Rough approximation validated in the proposal (section 9, item 7):
  // token count ~= JSON length / 3.
  return Math.ceil(JSON.stringify(value ?? null).length / 3);
}

interface FreshMatch {
  entry: CacheEntryRow;
  similarity: number;
}

async function lookupFresh(
  toolName: string,
  argsText: string,
  argumentsHash: string,
): Promise<FreshMatch | null> {
  try {
    const vector = await embedQuery(argsText);
    const match: SimilarityMatch | null = await cacheEntries.findBySimilarity(toolName, vector, {
      freshOnly: true,
    });
    if (match && match.similarity >= getSimilarityThreshold()) {
      return { entry: match, similarity: match.similarity };
    }
    return null;
  } catch (error) {
    if (!(error instanceof EmbeddingServiceError)) {
      throw error;
    }
    // Embedding service is down (proposal 8.2) — fall back to exact match.
    const match = await cacheEntries.findByHash(toolName, argumentsHash, { freshOnly: true });
    return match ? { entry: match, similarity: 1 } : null;
  }
}

function toResult(match: FreshMatch, stale: boolean): CachedCallResult {
  return {
    result: match.entry.result,
    cacheHit: true,
    similarity: stale ? null : match.similarity,
    tokensSaved: match.entry.result_tokens ?? estimateTokens(match.entry.result),
    stale,
  };
}

export async function executeCachedCall(params: CachedCallParams): Promise<CachedCallResult> {
  const { endpoint, toolName, arguments: args, importance } = params;
  const argsText = buildCacheText(toolName, args);
  const argumentsHash = hashArguments(args);

  const fresh = await lookupFresh(toolName, argsText, argumentsHash);
  if (fresh) {
    await cacheEntries.touchHit(fresh.entry.id);
    const result = toResult(fresh, false);
    await cacheLogs.logLookup({
      toolName,
      cacheHit: true,
      similarity: result.similarity,
      tokensSaved: result.tokensSaved,
    });
    return result;
  }

  return withStampedeLock(toolName, argumentsHash, async () => {
    // Double-checked locking: another request may have refreshed the entry
    // while we were waiting for the lock.
    const recheck = await lookupFresh(toolName, argsText, argumentsHash);
    if (recheck) {
      await cacheEntries.touchHit(recheck.entry.id);
      const result = toResult(recheck, false);
      await cacheLogs.logLookup({
        toolName,
        cacheHit: true,
        similarity: result.similarity,
        tokensSaved: result.tokensSaved,
      });
      return result;
    }

    try {
      const downstream = await callDownstreamTool(endpoint, toolName, args);
      const tokens = estimateTokens(downstream);

      let embedding: number[] | null = null;
      try {
        embedding = await embedPassage(argsText);
      } catch (error) {
        if (!(error instanceof EmbeddingServiceError)) {
          throw error;
        }
        // Stored without a vector; hash-based fallback lookups still work.
      }

      await cacheEntries.insertEntry({
        mcpEndpoint: endpoint,
        toolName,
        argumentsHash,
        argumentsRaw: args,
        embedding,
        result: downstream,
        resultTokens: tokens,
        importance,
        expiresAt: computeExpiresAt(importance),
      });

      await maybeEvict();

      const result: CachedCallResult = {
        result: downstream,
        cacheHit: false,
        similarity: null,
        tokensSaved: 0,
        stale: false,
      };
      await cacheLogs.logLookup({
        toolName,
        cacheHit: false,
        similarity: null,
        tokensSaved: 0,
      });
      return result;
    } catch (error) {
      if (error instanceof DownstreamMcpError) {
        // Origin MCP is down (proposal 8.3) — serve a stale entry if one
        // exists rather than propagating the error.
        const stale = await cacheEntries.findByHash(toolName, argumentsHash, {
          freshOnly: false,
        });
        if (stale) {
          const result = toResult({ entry: stale, similarity: 1 }, true);
          await cacheLogs.logLookup({
            toolName,
            cacheHit: true,
            similarity: null,
            tokensSaved: result.tokensSaved,
          });
          return result;
        }
      }
      throw error;
    }
  });
}
