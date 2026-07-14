import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { generateReportMarkdown, type BenchmarkReport, type ScenarioResult } from "./report.js";
import { startBenchmarkDownstreamServer } from "./downstream-server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const MCP_SERVER_URL = process.env.MCP_SERVER_URL ?? "http://localhost:3000/sse";
const DOWNSTREAM_PORT = 4500;
const DOWNSTREAM_ALIAS = "benchmark_kb";

interface ScenarioFile {
  id: string;
  name: string;
  description: string;
  importance: number;
  calls: Array<{ question: string }>;
}

// Same approximation as mcp-server/src/cache/cached-call.ts (proposal
// section 9, item 7: token count ~= JSON length / 3) — kept in sync so the
// "before" (uncached) and "after" (cached) totals are comparable apples-to-apples.
function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value ?? null).length / 3);
}

function loadScenarios(): ScenarioFile[] {
  const dir = join(__dirname, "scenarios");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf-8")) as ScenarioFile);
}

function textOf(result: CallToolResult): any {
  const first = result.content[0];
  if (!first || first.type !== "text") {
    throw new Error(`Expected text content, got: ${JSON.stringify(result)}`);
  }
  return JSON.parse(first.text);
}

async function runScenario(
  scenario: ScenarioFile,
  baselineClient: Client,
  cacheClient: Client,
): Promise<ScenarioResult> {
  // Reset so each scenario starts from a clean cache — results are
  // independently interpretable and don't depend on scenario order.
  await cacheClient.callTool({ name: "cache_clear", arguments: { target: "all" } });

  // Pass 1: "캐시 미사용" baseline — call the downstream tool directly, every time.
  let tokensBaseline = 0;
  let baselineLatencyTotal = 0;
  for (const call of scenario.calls) {
    const start = performance.now();
    // Measure tokens on the raw CallToolResult (not the unwrapped inner
    // JSON) — this must match what mcp-server itself measures internally
    // (cache/cached-call.ts's estimateTokens(downstream), where downstream
    // is this same raw shape), or "tokens saved" and "baseline tokens" end
    // up on different scales and the savings % becomes meaningless.
    const rawResult = (await baselineClient.callTool({
      name: "knowledge_lookup",
      arguments: { question: call.question },
    })) as CallToolResult;
    baselineLatencyTotal += performance.now() - start;
    tokensBaseline += estimateTokens(rawResult);
  }

  // Pass 2: "캐시 사용" — the same calls, through cached_call.
  let hitCount = 0;
  let tokensSaved = 0;
  let hitLatencyTotal = 0;
  let missLatencyTotal = 0;
  let missCount = 0;

  for (const call of scenario.calls) {
    const start = performance.now();
    const result = textOf(
      (await cacheClient.callTool({
        name: "cached_call",
        arguments: {
          endpoint: DOWNSTREAM_ALIAS,
          tool_name: "knowledge_lookup",
          arguments: JSON.stringify({ question: call.question }),
          importance: scenario.importance,
        },
      })) as CallToolResult,
    );
    const elapsed = performance.now() - start;

    if (result.cache_hit) {
      hitCount += 1;
      hitLatencyTotal += elapsed;
      tokensSaved += result.tokens_saved ?? 0;
    } else {
      missCount += 1;
      missLatencyTotal += elapsed;
    }
  }

  const totalCalls = scenario.calls.length;
  const tokensWithCache = tokensBaseline - tokensSaved;

  return {
    id: scenario.id,
    name: scenario.name,
    description: scenario.description,
    totalCalls,
    hitCount,
    missCount,
    hitRate: totalCalls > 0 ? hitCount / totalCalls : 0,
    tokensBaseline,
    tokensWithCache,
    tokensSaved,
    savingsPercent: tokensBaseline > 0 ? (tokensSaved / tokensBaseline) * 100 : 0,
    avgBaselineLatencyMs: totalCalls > 0 ? baselineLatencyTotal / totalCalls : 0,
    avgHitLatencyMs: hitCount > 0 ? hitLatencyTotal / hitCount : null,
    avgMissLatencyMs: missCount > 0 ? missLatencyTotal / missCount : null,
  };
}

async function main() {
  console.log("Starting benchmark downstream server...");
  const downstream = await startBenchmarkDownstreamServer(DOWNSTREAM_PORT);

  console.log("Connecting to mcp-server (with-cache path) and downstream (baseline path)...");
  const cacheClient = new Client({ name: "benchmark-cached", version: "0.1.0" });
  await cacheClient.connect(new SSEClientTransport(new URL(MCP_SERVER_URL)));

  const baselineClient = new Client({ name: "benchmark-baseline", version: "0.1.0" });
  await baselineClient.connect(new StreamableHTTPClientTransport(new URL(downstream.url)));

  // mcp-server runs inside docker-compose; it must reach this host-side
  // downstream server via host.docker.internal, not localhost.
  const containerVisibleUrl = downstream.url.replace("localhost", "host.docker.internal");
  await cacheClient.callTool({
    name: "register_mcp",
    arguments: { alias: DOWNSTREAM_ALIAS, endpoint: containerVisibleUrl },
  });

  const scenarios = loadScenarios();
  const results: ScenarioResult[] = [];

  for (const scenario of scenarios) {
    console.log(`Running scenario: ${scenario.name} (${scenario.calls.length} calls x2 passes)...`);
    const result = await runScenario(scenario, baselineClient, cacheClient);
    results.push(result);
    console.log(
      `  hit rate ${(result.hitRate * 100).toFixed(1)}%, savings ${result.savingsPercent.toFixed(1)}%`,
    );
  }

  await cacheClient.callTool({ name: "cache_clear", arguments: { target: "all" } });

  const overall = results.reduce(
    (acc, s) => ({
      totalCalls: acc.totalCalls + s.totalCalls,
      hitCount: acc.hitCount + s.hitCount,
      tokensBaseline: acc.tokensBaseline + s.tokensBaseline,
      tokensWithCache: acc.tokensWithCache + s.tokensWithCache,
      tokensSaved: acc.tokensSaved + s.tokensSaved,
    }),
    { totalCalls: 0, hitCount: 0, tokensBaseline: 0, tokensWithCache: 0, tokensSaved: 0 },
  );

  const report: BenchmarkReport = {
    generatedAt: new Date().toISOString(),
    scenarios: results,
    overall: {
      ...overall,
      hitRate: overall.totalCalls > 0 ? overall.hitCount / overall.totalCalls : 0,
      savingsPercent:
        overall.tokensBaseline > 0 ? (overall.tokensSaved / overall.tokensBaseline) * 100 : 0,
    },
  };

  const markdown = generateReportMarkdown(report);
  const reportPath = join(__dirname, "REPORT.md");
  writeFileSync(reportPath, markdown, "utf-8");
  console.log(`\nReport written to ${reportPath}`);
  console.log(
    `\nOverall: ${overall.hitCount}/${overall.totalCalls} hits, ${report.overall.savingsPercent.toFixed(1)}% token savings`,
  );

  await cacheClient.close();
  await baselineClient.close();
  await downstream.close();
}

main().catch((error) => {
  console.error("Benchmark failed:", error);
  process.exit(1);
});
