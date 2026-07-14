import { createHash } from "node:crypto";

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, val]) => [key, sortKeysDeep(val)]),
    );
  }
  return value;
}

function canonicalizeArguments(args: Record<string, unknown>): string {
  return JSON.stringify(sortKeysDeep(args));
}

// SHA-256 over the canonicalized arguments — used as the exact-match fallback
// key when the embedding service is unavailable (proposal 8.2).
export function hashArguments(args: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalizeArguments(args)).digest("hex");
}

// The text that actually gets embedded (before the query:/passage: prefix is
// added): tool_name + arguments, per proposal 3.4 Step 1.
export function buildCacheText(toolName: string, args: Record<string, unknown>): string {
  return `${toolName} ${canonicalizeArguments(args)}`;
}

// Deterministic 64-bit signed key for pg_advisory_xact_lock, scoped to
// (toolName, argumentsHash) so unrelated calls never contend on the same lock.
export function advisoryLockKey(toolName: string, argumentsHash: string): string {
  const digest = createHash("sha256").update(`${toolName}:${argumentsHash}`).digest();
  return digest.readBigInt64BE(0).toString();
}
