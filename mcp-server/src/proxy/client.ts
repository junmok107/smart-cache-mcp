import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// One connected Client per downstream endpoint, reused across calls instead
// of reconnecting on every cache-miss.
const clients = new Map<string, Client>();

export async function getClient(endpoint: string): Promise<Client> {
  const existing = clients.get(endpoint);
  if (existing) {
    return existing;
  }

  const client = new Client({ name: "smart-cache-mcp-proxy", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint));
  await client.connect(transport);

  clients.set(endpoint, client);
  return client;
}

// Drop a client after a failed call so the next call reconnects instead of
// reusing a possibly broken connection.
export function dropClient(endpoint: string): void {
  clients.delete(endpoint);
}

export async function closeAllClients(): Promise<void> {
  const all = [...clients.values()];
  clients.clear();
  await Promise.all(all.map((client) => client.close()));
}
