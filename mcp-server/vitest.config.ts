import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Integration tests hit the docker-compose stack from the host, so they
    // use the host-published ports (see CLAUDE.md "Windows 포트 충돌" for why
    // postgres is 15432 instead of 5432). Override via real env vars if your
    // setup differs.
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgresql://smartcache:changeme@localhost:15432/smart_cache_mcp",
      EMBEDDING_SERVICE_URL: process.env.EMBEDDING_SERVICE_URL ?? "http://localhost:8000",
    },
  },
});
