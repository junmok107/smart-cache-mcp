import { pool } from "./pool.js";

export interface LogLookupParams {
  toolName: string;
  cacheHit: boolean;
  similarity: number | null;
  tokensSaved: number;
}

export async function logLookup(params: LogLookupParams): Promise<void> {
  await pool.query(
    `INSERT INTO cache_logs (tool_name, cache_hit, similarity, tokens_saved)
     VALUES ($1, $2, $3, $4)`,
    [params.toolName, params.cacheHit, params.similarity, params.tokensSaved],
  );
}

export interface OverallStats {
  totalLookups: number;
  totalHits: number;
  hitRate: number;
  tokensSavedTotal: number;
}

export async function overallStats(): Promise<OverallStats> {
  const { rows } = await pool.query<{
    total_lookups: string;
    total_hits: string;
    tokens_saved_total: string;
  }>(
    `SELECT
       count(*) AS total_lookups,
       count(*) FILTER (WHERE cache_hit) AS total_hits,
       coalesce(sum(tokens_saved) FILTER (WHERE cache_hit), 0) AS tokens_saved_total
     FROM cache_logs`,
  );
  const row = rows[0];
  const totalLookups = Number(row.total_lookups);
  const totalHits = Number(row.total_hits);
  return {
    totalLookups,
    totalHits,
    hitRate: totalLookups > 0 ? totalHits / totalLookups : 0,
    tokensSavedTotal: Number(row.tokens_saved_total),
  };
}

export interface ToolHitRate {
  toolName: string;
  totalLookups: number;
  totalHits: number;
  hitRate: number;
}

export async function topToolsByHitRate(limit: number): Promise<ToolHitRate[]> {
  const { rows } = await pool.query<{
    tool_name: string;
    total_lookups: string;
    total_hits: string;
  }>(
    `SELECT tool_name, count(*) AS total_lookups, count(*) FILTER (WHERE cache_hit) AS total_hits
     FROM cache_logs
     GROUP BY tool_name
     ORDER BY (count(*) FILTER (WHERE cache_hit))::float / count(*) DESC, count(*) DESC
     LIMIT $1`,
    [limit],
  );
  return rows.map((row) => {
    const totalLookups = Number(row.total_lookups);
    const totalHits = Number(row.total_hits);
    return {
      toolName: row.tool_name,
      totalLookups,
      totalHits,
      hitRate: totalLookups > 0 ? totalHits / totalLookups : 0,
    };
  });
}
