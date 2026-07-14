# Smart Cache MCP — 최종 프로젝트 상태

작성일: 2026-07-14 | 최신 커밋: [`1f76f7e`](https://github.com/junmok107/smart-cache-mcp/commit/1f76f7e) | 저장소: [github.com/junmok107/smart-cache-mcp](https://github.com/junmok107/smart-cache-mcp)

이 문서는 프로젝트 전체(기획 → 구현 → 검증 → 냉철한 재평가 → 보완 → 재랭킹 도입)의 최종 스냅샷이다. 개발 과정의 상세 기록은 [`CLAUDE.md`](../CLAUDE.md), 사용법은 [`README.md`](../README.md)를 참고.

## 한 줄 요약

AI가 MCP 도구를 호출할 때마다 소비하는 토큰을 줄이는 캐싱 프록시 MCP 서버. `cached_call` 하나로 캐시 조회 → (미스 시) 원본 호출 → 저장이 자동 처리되고, 임베딩+재랭킹 기반 2단계 퍼지 매칭으로 의미적으로 유사한 요청도 캐시 히트로 처리한다. 실측 토큰 절감률 **77.8%**.

## 개발 타임라인

기획서(`smart-cache-mcp-proposal.docx`) 기반으로 8단계(0~7단계)를 거쳐 개발 완료 후, 프로젝트를 다방면으로 냉철하게 재평가하고 발견된 항목들을 실제로 반영하는 사후 개선 라운드를 진행했다.

| 단계 | 내용 | 상태 |
|---|---|---|
| 0단계 | CLAUDE.md, .env.example, .gitignore, docker-compose.yml, 디렉토리 구조 | 완료 |
| 1단계 | Docker Compose + DB 스키마 + 기본 서버 기동 | 완료 |
| 2단계 | 임베딩 서비스 (FastAPI + multilingual-e5-base, CUDA) | 완료 |
| 3단계 | MCP 프록시 로직 (하위 서버 연결, JSON-RPC 중계) | 완료 |
| 4단계 | 캐시 로직 (벡터 검색, TTL, 교체, 스탬피드, 폴백, SWR) | 완료 |
| 5단계 | 5개 MCP 도구 구현 | 완료 |
| 6단계 | 통합 테스트 (vitest + pytest) | 완료 |
| 7단계 | 벤치마크 및 토큰 절감 검증 | 완료 |
| 사후 개선 1 | 냉철한 재평가 → ESLint, SSRF 방어, GitHub Actions CI | 완료 |
| 사후 개선 2 | 인증(`MCP_AUTH_TOKEN`) + 전역 레이트리밋/위협탐지/감사로그 | 완료 |
| 사후 개선 3 | 실제 GitHub Actions에서 CI 그린 확인 + 액션 버전 업그레이드 | 완료 |
| 사후 개선 4 | 검색-후-재랭킹(retrieve-then-rerank) 2단계 캐시 매칭 도입 | 완료 |

각 단계는 `docker-compose up --build`로 정상 기동을 확인하며 진행했고, 사후 개선은 실제 라이브 MCP 클라이언트 호출로 검증했다.

## 아키텍처

```
AI / MCP 클라이언트
   │ cached_call (SSE, :3000/sse)
   ▼
mcp-server (TypeScript, @airmcp-dev/core)
   │                                      │
   │ 항상: 임베딩+유사도 검색+재랭킹       │ 미스 시에만
   ▼                                      ▼
embedding-service                    하위 MCP 서버
(FastAPI + e5-base + bge-reranker-v2-m3, CUDA)  (원본 도구)
   │
   ▼
PostgreSQL + pgvector (HNSW, top-K 후보 검색)
```

3개 컨테이너(mcp-server / embedding-service / postgres)가 Docker Compose로 함께 뜬다.

## 핵심 기능

- **퍼지 매칭 (2단계 검색-후-재랭킹)**: 1단계 `multilingual-e5-base`(768차원) + pgvector HNSW 코사인 유사도로 top-5 후보 검색, 2단계 `BAAI/bge-reranker-v2-m3` cross-encoder가 재채점해 최종 히트/미스 결정 (임계값 0.60). 상세 근거·실측값은 CLAUDE.md 11장
- **중요도 기반 TTL**: importance 1~5 → 5분~48시간
- **우선순위 기반 교체**: `importance × log₂(hit_count+2) × recency_weight` (recency half-life 72시간), `CACHE_MAX_ENTRIES`(기본 50,000건) 초과 시 트리거
- **장애 대응 4종**: Advisory Lock 스탬피드 방지, 코사인 유사도 판정으로 자동 강등(재랭킹 장애 시), SHA-256 해시 폴백(임베딩 장애 시), stale-while-revalidate(원본 장애 시)
- **5개 도구**: `cached_call`, `register_mcp`, `cache_stats`, `cache_clear`, `cache_config`

## 보안

| 항목 | 상태 |
|---|---|
| SSRF 방어 | `register_mcp`가 `NODE_ENV=production`에서 사설/루프백/링크로컬(클라우드 메타데이터 포함) 등록을 차단 |
| 인증 | `MCP_AUTH_TOKEN` 설정 시 opt-in으로 5개 도구 전체에 토큰 인증 강제 (API 키 수준 — 프레임워크 자체 문서도 실서비스는 OAuth 2.1 권장) |
| 레이트리밋 | 항상 켜짐, 도구별 호출 한도 (`cache_clear` 5회/분으로 가장 타이트) |
| 위협탐지/감사로그 | 프롬프트·명령어 인젝션·경로순회 패턴 탐지, 모든 판정 로그 기록 |
| TLS / 다중 인스턴스 이중화 | **의도적으로 미구현**. TLS는 리버스 프록시가 담당하는 게 표준이라 앱 코드 문제가 아니며, 이중화는 SSE transport가 인메모리 세션이라 아키텍처 재설계급이라 포트폴리오 스코프를 벗어난다고 판단 (근거는 CLAUDE.md 10장) |

## 검증 현황

- **단위/통합 테스트**: mcp-server vitest 32개(unit 18 + integration 14), embedding-service pytest 7개(재랭킹 3개 포함) — 전부 통과
- **CI**: GitHub Actions에서 lint+build+unit, 실제 `docker compose` 스택 기동 후 integration까지 자동 실행. **로컬 검증만으로 끝내지 않고 `gh run watch`로 실제 그린 상태를 2회 연속 직접 확인**함 (도중 `host.docker.internal`이 Docker Desktop 전용이라 GitHub의 리눅스 러너에서 깨지는 걸 발견해 `extra_hosts`로 수정)
- **실제 라이브 검증**: 실제 Claude 클라이언트 ↔ `mcp-remote` ↔ SSE 연결로 2라운드(기본 동작 + 개발/기획/개발공부 페르소나별 시나리오) 수동 테스트, 인증/레이트리밋도 `MCP_AUTH_TOKEN`을 실제로 켜서 라이브 검증, 재랭킹 도입 후 교차언어 히트/ML-DL 오탐도 실제 `cached_call`로 재검증 → 상세 기록은 [`docs/live-mcp-verification.md`](live-mcp-verification.md), 재랭킹 실측값은 CLAUDE.md 11장
- **벤치마크**: 4개 시나리오, 총 46회 호출, "캐시 미사용" 수치도 독립 실측 → 상세는 [`benchmark/REPORT.md`](../benchmark/REPORT.md)

| 시나리오 | 히트율 | 절감률 |
|---|---|---|
| 동일 질의 반복 | 90.0% | 90.0% |
| 유사 질의 변형 | 90.0% | 90.0% |
| 다국어 질의 | 80.0% | 80.1% |
| 혼합 워크로드 | 62.5% | 62.1% |
| **전체** | **78.3%** | **77.8%** |

재랭킹 도입 전 수치(65.2%/64.9%)와 비교하면 다국어 질의 시나리오가 50%→80%로 가장 크게 개선됐다 — 이 표는 재랭킹 반영 후 재측정한 값이다.

## 정직하게 밝히는 한계

- **지연시간**: 이번 벤치마크의 목업 다운스트림이 비현실적으로 가벼워서, 캐시 hit(임베딩+벡터검색+재랭킹 필요, ~38ms — 재랭킹 도입으로 네트워크 왕복이 1회 더 늘어 이전(~15ms)보다 더 느려졌다)가 캐시 미사용 기준선(~2ms)보다 오히려 느리게 측정됐다. 실제로 무거운 원본 MCP(검색 API, LLM 호출 등)라면 지연시간도 함께 줄어들 것으로 예상되지만 검증하지는 못했다.
- **교차언어 매칭**: 재랭킹 도입으로 개선됐다. "What is artificial intelligence?"가 캐시된 "인공지능이란 무엇인가요?"와 매칭되지 않던 사례를 재랭킹 도입 후 라이브로 재검증한 결과 정상 히트(`similarity: 0.731`)로 확인했다.
- **밀접하게 관련된 개념 간 오탐**: 재랭킹으로도 완전히는 못 풀었다. "머신러닝이 뭔가요?"와 "딥러닝이 뭔가요?"는 서로 다른 개념(다른 답이 필요)인데도 재랭킹 점수가 0.60~0.72로 진짜 매치의 점수대(0.72~0.99)와 거의 겹쳐, 임계값 조정만으로는 깔끔하게 가르지 못한다는 것을 실측으로 확인했다 (CLAUDE.md 11장 "아직 안 풀리는 한계").
- **재랭킹 경계 사례의 실행 간 편차**: 재랭킹 점수가 임계값(0.60)에 바짝 붙는 경우, GPU 배치 추론의 부동소수점 비결정성 때문에 벤치마크를 반복 실행하면 히트/미스가 소폭 달라질 수 있음을 실측으로 확인했다 (같은 4개 시나리오를 3회 반복 실행해 전체 히트율 77.8%~84.8% 범위에서 관측됨).
- **`CACHE_MAX_SIZE_MB`**: `.env`에 정의만 되어 있고 `eviction.ts`가 읽지 않는 미사용 설정값이다 (기획서 자체의 표 vs 상세 절 간 내부 모순에서 비롯됨, 개수 기준만 실제로 동작).
- **인증 수준**: `authPlugin`은 API 키 방식이며 OAuth 2.1급 인증이 아니다.
- **프레임워크 버그 2건 발견**: `@airmcp-dev/core` 0.3.0의 http transport는 프로세스당 세션을 1개만 지원해 SSE로 전환해 회피했고, `authPlugin`의 거부 응답이 `isError` 플래그 없이 전달되는 것도 확인해 문서화했다.

## 냉철한 자체 평가

100점 만점 다방면 평가 결과 **92/100**. 세부 배점과 근거는 CLAUDE.md 10장에 기록되어 있으며, 핵심 요지:

- 포트폴리오 프로젝트로서는 상위권 — 요구사항 구현 완성도, 검증 깊이(자동+수동+실제 클라이언트+실제 CI), 실패/한계를 숨기지 않는 문서화가 강점
- "실서비스" 기준으로 보면 후한 점수 — OAuth급 인증, TLS, 다중 인스턴스 이중화, 대규모 부하 테스트가 없다는 걸 감안하면 프로덕션 배포 전제로는 이보다 낮게 봐야 함
- 감점 없이 만점인 항목: 문서화, 개발 프로세스(발견한 버그를 우회가 아니라 근본 원인 규명 후 수정)

## 관련 문서

- [`CLAUDE.md`](../CLAUDE.md) — 개발 전 과정 상세 기록, 설계 결정 근거, 발견한 이슈와 해결 과정, 자체 평가 세부 배점
- [`README.md`](../README.md) — 사용법, 빠른 시작, 인증/레이트리밋 설정 가이드
- [`docs/live-mcp-verification.md`](live-mcp-verification.md) — 실제 클라이언트 라이브 검증 기록
- [`benchmark/REPORT.md`](../benchmark/REPORT.md) — 토큰 절감 벤치마크 원자료
- [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) — CI 워크플로
