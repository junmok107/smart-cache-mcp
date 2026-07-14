import { cacheEntries } from "../db/index.js";

// Read at call time (not module load) so a future cache_config tool can
// change this at runtime without a process restart.
function getMaxEntries(): number {
  return Number(process.env.CACHE_MAX_ENTRIES ?? 50000);
}

// Eviction order (proposal 6.2): 1) TTL-expired entries first (they're
// invalid anyway), 2) lowest priority_score among what's left.
export async function maybeEvict(): Promise<void> {
  const maxEntries = getMaxEntries();
  const count = await cacheEntries.countEntries();
  if (count < maxEntries) {
    return;
  }

  await cacheEntries.deleteExpired();

  const remaining = await cacheEntries.countEntries();
  const overBy = remaining - maxEntries + 1;
  if (overBy > 0) {
    await cacheEntries.deleteLowestPriority(overBy);
  }
}
