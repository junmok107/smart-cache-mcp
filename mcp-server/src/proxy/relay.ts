import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { dropClient, getClient } from "./client.js";

// Raised on connection/protocol failures talking to a downstream MCP server.
// Distinct from a tool-level error, which the downstream server reports as a
// normal CallToolResult with isError: true.
export class DownstreamMcpError extends Error {
  readonly endpoint: string;

  constructor(message: string, endpoint: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DownstreamMcpError";
    this.endpoint = endpoint;
  }
}

export async function callDownstreamTool(
  endpoint: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  try {
    const client = await getClient(endpoint);
    const result = await client.callTool({ name: toolName, arguments: args });
    return result as CallToolResult;
  } catch (error) {
    dropClient(endpoint);
    throw new DownstreamMcpError(
      `Failed to call tool "${toolName}" on downstream MCP server ${endpoint}`,
      endpoint,
      { cause: error },
    );
  }
}
