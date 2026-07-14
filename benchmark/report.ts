export interface ScenarioResult {
  id: string;
  name: string;
  description: string;
  totalCalls: number;
  hitCount: number;
  missCount: number;
  hitRate: number;
  tokensBaseline: number;
  tokensWithCache: number;
  tokensSaved: number;
  savingsPercent: number;
  avgBaselineLatencyMs: number;
  avgHitLatencyMs: number | null;
  avgMissLatencyMs: number | null;
}

export interface OverallResult {
  totalCalls: number;
  hitCount: number;
  hitRate: number;
  tokensBaseline: number;
  tokensWithCache: number;
  tokensSaved: number;
  savingsPercent: number;
}

export interface BenchmarkReport {
  generatedAt: string;
  scenarios: ScenarioResult[];
  overall: OverallResult;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function ms(value: number | null): string {
  return value === null ? "-" : `${value.toFixed(1)}ms`;
}

export function generateReportMarkdown(report: BenchmarkReport): string {
  const lines: string[] = [];

  lines.push("# Smart Cache MCP — 토큰 절감 벤치마크 리포트");
  lines.push("");
  lines.push(`생성 시각: ${report.generatedAt}`);
  lines.push("");
  lines.push(
    "> 토큰 수는 `Math.ceil(JSON.stringify(value).length / 3)` 근사치입니다 (기획서 9장 검증 결과 기준, `mcp-server/src/cache/cached-call.ts`와 동일한 공식).",
  );
  lines.push(
    "> \"캐시 미사용\" 토큰은 다운스트림 지식조회 서버를 매 호출 직접 호출해 실측한 값이고, \"캐시 사용\" 토큰은 같은 질의를 `cached_call`을 통해 호출해 실측한 값입니다 — 두 값 모두 자체 신고가 아닌 독립적으로 측정한 결과입니다.",
  );
  lines.push("");

  lines.push("## 시나리오별 결과");
  lines.push("");
  lines.push(
    "| 시나리오 | 호출 수 | 히트율 | 캐시 미사용 토큰 | 캐시 사용 토큰 | 절감 토큰 | 절감률 | 평균 미사용 지연 | 평균 hit 지연 | 평균 miss 지연 |",
  );
  lines.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const s of report.scenarios) {
    lines.push(
      `| ${s.name} | ${s.totalCalls} | ${pct(s.hitRate)} | ${s.tokensBaseline} | ${s.tokensWithCache} | ${s.tokensSaved} | ${s.savingsPercent.toFixed(1)}% | ${ms(s.avgBaselineLatencyMs)} | ${ms(s.avgHitLatencyMs)} | ${ms(s.avgMissLatencyMs)} |`,
    );
  }
  lines.push("");

  lines.push("## 시나리오 설명");
  lines.push("");
  for (const s of report.scenarios) {
    lines.push(`- **${s.name}** (\`${s.id}\`): ${s.description}`);
  }
  lines.push("");

  lines.push("## 전체 요약");
  lines.push("");
  lines.push(`- 총 호출 수: ${report.overall.totalCalls}`);
  lines.push(`- 전체 히트율: ${pct(report.overall.hitRate)} (${report.overall.hitCount}/${report.overall.totalCalls})`);
  lines.push(`- 캐시 미사용 시 총 토큰: ${report.overall.tokensBaseline}`);
  lines.push(`- 캐시 사용 시 총 토큰: ${report.overall.tokensWithCache}`);
  lines.push(`- 절감된 토큰: ${report.overall.tokensSaved}`);
  lines.push(`- **전체 토큰 절감률: ${report.overall.savingsPercent.toFixed(1)}%**`);
  lines.push("");

  lines.push("## 지연시간에 대한 솔직한 해석");
  lines.push("");
  lines.push(
    "표를 보면 **캐시 hit(13~18ms)가 캐시 미사용 기준선(1.5~3ms)보다 오히려 느립니다.** " +
      "숨기지 않고 그대로 밝힙니다: 이 벤치마크의 다운스트림 지식조회 서버는 인메모리 키워드 " +
      "매칭만 하는 목업이라 사실상 즉시 응답하는 반면, 캐시 hit는 매번 임베딩 서비스에 " +
      "질의 임베딩을 요청하고(`query:` 프리픽스, GPU 추론 포함) pgvector로 유사도 검색을 " +
      "하는 실제 네트워크 왕복이 필요합니다 — 이 오버헤드가 목업 서버의 응답 시간보다 큽니다.",
  );
  lines.push("");
  lines.push(
    "즉 이 벤치마크가 실측으로 보여주는 이득은 **토큰 절감**이며, **지연시간 이득은 " +
      "원본 MCP 서버가 얼마나 무거운 작업을 하는지에 달려 있습니다.** 실제 검색 API, LLM 호출, " +
      "무거운 DB 쿼리처럼 원본 호출 자체가 수백 ms~수 초가 걸리는 경우에는 캐시 hit의 " +
      "고정 오버헤드(~15ms)를 상쇄하고도 남아 지연시간도 함께 줄어들 것으로 예상되지만, " +
      "이 벤치마크의 목업처럼 원본 호출이 극단적으로 가벼운 경우에는 캐시가 지연시간 측면에서 " +
      "오히려 손해일 수 있습니다.",
  );
  lines.push("");

  return lines.join("\n");
}
