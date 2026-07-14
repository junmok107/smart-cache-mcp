import { mcpRegistry } from "../db/index.js";

const URL_PATTERN = /^https?:\/\//i;

// cached_call's "endpoint" param can be a raw URL or an alias registered via
// register_mcp (proposal 4.1/4.2). Alias resolution is deliberately kept out
// of cache/executeCachedCall, which only ever sees an already-resolved URL.
export async function resolveEndpoint(endpointOrAlias: string): Promise<string> {
  if (URL_PATTERN.test(endpointOrAlias)) {
    return endpointOrAlias;
  }
  const entry = await mcpRegistry.findByAlias(endpointOrAlias);
  if (!entry) {
    throw new Error(
      `Unknown MCP alias "${endpointOrAlias}" — register it first with register_mcp, or pass a full http(s):// URL.`,
    );
  }
  return entry.endpoint;
}
