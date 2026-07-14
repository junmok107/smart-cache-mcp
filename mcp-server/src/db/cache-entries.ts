import { pool } from "./pool.js";

export interface CacheEntryRow {
  id: string;
  mcp_endpoint: string | null;
  tool_name: string;
  arguments_hash: string | null;
  arguments_raw: unknown;
  result: unknown;
  result_tokens: number | null;
  importance: number | null;
  hit_count: number;
  created_at: Date;
  last_accessed: Date;
  expires_at: Date;
}

export interface SimilarityMatch extends CacheEntryRow {
  similarity: number;
}

// recency_weight = 0.5 ^ (hours_since_last_access / half_life) — see CLAUDE.md
// "캐시 교체(eviction) 우선순위 점수 공식" for the rationale (half-life = 72h,
// confirmed with the user since the proposal only specified the shape, not
// the exact decay curve).
const RECENCY_HALF_LIFE_HOURS = 72;

const PRIORITY_SCORE_SQL = `
  importance
  * (ln(hit_count + 2) / ln(2))
  * power(0.5, extract(epoch from (now() - last_accessed)) / 3600.0 / ${RECENCY_HALF_LIFE_HOURS})
`;

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

// Stage 1 of retrieve-then-rerank (see CLAUDE.md "reranking" section): HNSW
// cosine search returns the top-K closest candidates, unfiltered by
// threshold — the actual accept/reject decision is made by the cross-encoder
// reranker in cache/cached-call.ts, not here.
export async function findTopKBySimilarity(
  toolName: string,
  embedding: number[],
  k: number,
  options: { freshOnly?: boolean } = {},
): Promise<SimilarityMatch[]> {
  const { freshOnly = true } = options;
  const vector = toVectorLiteral(embedding);
  const freshClause = freshOnly ? "AND expires_at > now()" : "";
  const { rows } = await pool.query<SimilarityMatch>(
    `SELECT *, 1 - (embedding <=> $1::vector) AS similarity
     FROM cache_entries
     WHERE tool_name = $2 AND embedding IS NOT NULL ${freshClause}
     ORDER BY embedding <=> $1::vector
     LIMIT $3`,
    [vector, toolName, k],
  );
  return rows;
}

export async function findByHash(
  toolName: string,
  argumentsHash: string,
  options: { freshOnly?: boolean } = {},
): Promise<CacheEntryRow | null> {
  const { freshOnly = true } = options;
  const freshClause = freshOnly ? "AND expires_at > now()" : "";
  const { rows } = await pool.query<CacheEntryRow>(
    `SELECT * FROM cache_entries
     WHERE tool_name = $1 AND arguments_hash = $2 ${freshClause}
     ORDER BY created_at DESC
     LIMIT 1`,
    [toolName, argumentsHash],
  );
  return rows[0] ?? null;
}

export interface NewCacheEntry {
  mcpEndpoint: string;
  toolName: string;
  argumentsHash: string;
  argumentsRaw: unknown;
  embedding: number[] | null;
  result: unknown;
  resultTokens: number;
  importance: number;
  expiresAt: Date;
}

export async function insertEntry(entry: NewCacheEntry): Promise<CacheEntryRow> {
  const { rows } = await pool.query<CacheEntryRow>(
    `INSERT INTO cache_entries
       (mcp_endpoint, tool_name, arguments_hash, arguments_raw, embedding, result, result_tokens, importance, expires_at)
     VALUES ($1, $2, $3, $4, $5::vector, $6, $7, $8, $9)
     RETURNING *`,
    [
      entry.mcpEndpoint,
      entry.toolName,
      entry.argumentsHash,
      JSON.stringify(entry.argumentsRaw),
      entry.embedding ? toVectorLiteral(entry.embedding) : null,
      JSON.stringify(entry.result),
      entry.resultTokens,
      entry.importance,
      entry.expiresAt,
    ],
  );
  return rows[0];
}

export async function touchHit(id: string): Promise<void> {
  await pool.query(
    `UPDATE cache_entries SET hit_count = hit_count + 1, last_accessed = now() WHERE id = $1`,
    [id],
  );
}

export async function countEntries(): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM cache_entries`,
  );
  return rows[0].count;
}

export async function deleteExpired(): Promise<number> {
  const { rowCount } = await pool.query(`DELETE FROM cache_entries WHERE expires_at <= now()`);
  return rowCount ?? 0;
}

export async function deleteLowestPriority(limit: number): Promise<number> {
  const { rowCount } = await pool.query(
    `DELETE FROM cache_entries
     WHERE id IN (
       SELECT id FROM cache_entries
       ORDER BY ${PRIORITY_SCORE_SQL} ASC
       LIMIT $1
     )`,
    [limit],
  );
  return rowCount ?? 0;
}

export async function deleteAll(): Promise<number> {
  const { rowCount } = await pool.query(`DELETE FROM cache_entries`);
  return rowCount ?? 0;
}

export async function deleteByEndpoint(endpoint: string): Promise<number> {
  const { rowCount } = await pool.query(`DELETE FROM cache_entries WHERE mcp_endpoint = $1`, [
    endpoint,
  ]);
  return rowCount ?? 0;
}

export async function deleteByToolName(toolName: string): Promise<number> {
  const { rowCount } = await pool.query(`DELETE FROM cache_entries WHERE tool_name = $1`, [
    toolName,
  ]);
  return rowCount ?? 0;
}

export interface TopHitEntry {
  tool_name: string;
  arguments_raw: unknown;
  hit_count: number;
}

export async function topHitEntries(limit: number): Promise<TopHitEntry[]> {
  const { rows } = await pool.query<TopHitEntry>(
    `SELECT tool_name, arguments_raw, hit_count FROM cache_entries ORDER BY hit_count DESC LIMIT $1`,
    [limit],
  );
  return rows;
}

export async function totalEntriesSizeBytes(): Promise<number> {
  const { rows } = await pool.query<{ bytes: string }>(
    `SELECT pg_total_relation_size('cache_entries') AS bytes`,
  );
  return Number(rows[0].bytes);
}
