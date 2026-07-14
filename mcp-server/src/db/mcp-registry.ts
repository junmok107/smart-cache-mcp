import { pool } from "./pool.js";

export interface McpRegistryRow {
  alias: string;
  endpoint: string;
  created_at: Date;
}

export async function upsertAlias(alias: string, endpoint: string): Promise<McpRegistryRow> {
  const { rows } = await pool.query<McpRegistryRow>(
    `INSERT INTO mcp_registry (alias, endpoint) VALUES ($1, $2)
     ON CONFLICT (alias) DO UPDATE SET endpoint = EXCLUDED.endpoint
     RETURNING *`,
    [alias, endpoint],
  );
  return rows[0];
}

export async function findByAlias(alias: string): Promise<McpRegistryRow | null> {
  const { rows } = await pool.query<McpRegistryRow>(`SELECT * FROM mcp_registry WHERE alias = $1`, [
    alias,
  ]);
  return rows[0] ?? null;
}

export async function listAliases(): Promise<McpRegistryRow[]> {
  const { rows } = await pool.query<McpRegistryRow>(`SELECT * FROM mcp_registry ORDER BY alias`);
  return rows;
}
