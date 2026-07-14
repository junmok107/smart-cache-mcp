type ImportanceLevel = 1 | 2 | 3 | 4 | 5;

const DEFAULT_TTL_SECONDS: Record<ImportanceLevel, number> = {
  1: 300, // 5 min
  2: 1800, // 30 min
  3: 7200, // 2 hours
  4: 86400, // 24 hours
  5: 172800, // 48 hours
};

function clampImportance(importance: number): ImportanceLevel {
  const rounded = Math.round(importance);
  return Math.min(5, Math.max(1, rounded)) as ImportanceLevel;
}

export function ttlSecondsForImportance(importance: number): number {
  const level = clampImportance(importance);
  const envValue = process.env[`CACHE_TTL_IMPORTANCE_${level}`];
  return envValue ? Number(envValue) : DEFAULT_TTL_SECONDS[level];
}

export function computeExpiresAt(importance: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + ttlSecondsForImportance(importance) * 1000);
}
