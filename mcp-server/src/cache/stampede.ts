import { pool } from "../db/pool.js";
import { advisoryLockKey } from "./hash.js";

// Cache-stampede guard (proposal 8.1): when a TTL just expired and the same
// request arrives concurrently, the first caller holds a PostgreSQL advisory
// lock (scoped to this tool_name + arguments) while it refreshes the entry;
// everyone else blocks until it commits, then re-checks the cache instead of
// also calling the downstream MCP server.
export async function withStampedeLock<T>(
  toolName: string,
  argumentsHash: string,
  fn: () => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  const key = advisoryLockKey(toolName, argumentsHash);
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [key]);
    const result = await fn();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
