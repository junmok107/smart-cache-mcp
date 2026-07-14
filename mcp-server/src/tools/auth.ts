import { z } from "zod";

// Auth is opt-in via MCP_AUTH_TOKEN so local/single-user development stays
// zero-config (matches the NODE_ENV-gated SSRF guard's philosophy) — anyone
// exposing this server beyond localhost should set the env var.
export const AUTH_ENABLED = Boolean(process.env.MCP_AUTH_TOKEN);

// Spread into every tool's `params` so the field is only advertised (and
// required by @airmcp-dev/core's authPlugin) when auth is actually turned
// on. authPlugin strips "_auth" from params before the handler runs, so
// handlers never need to know about it.
//
// Explicitly typed as Record<string, ZodTypeAny> (rather than letting TS
// infer the union of the two branches) — otherwise the `{}` branch infers
// as `{ _auth?: undefined }`, which doesn't satisfy AirToolParams' index
// signature once spread alongside sibling params.
export const authParams: Record<string, z.ZodTypeAny> = AUTH_ENABLED
  ? { _auth: z.string().describe("서버 인증 토큰 (MCP_AUTH_TOKEN 값)") }
  : {};
