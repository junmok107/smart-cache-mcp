# Smart Cache MCP

> **상태: 7단계 (벤치마크 및 토큰 절감 검증) 완료 — 전체 개발 단계 완료.** 이 문서는 개발이 진행되면서 실제 구현 내용에 맞게 계속 업데이트됩니다.

## 1. 프로젝트 개요

Smart Cache MCP는 AI와 하위 MCP 서버 사이에서 프록시로 동작하며, 도구 호출 결과를 벡터 유사도 기반으로 자동 캐싱해 토큰 소비를 줄이는 MCP 서버다.

AI는 하위 MCP를 직접 호출하는 대신 `cached_call` 도구 하나만 호출하면, 캐시 조회 → (미스 시) 원본 MCP 호출 → 결과 저장이 내부에서 자동 처리된다. 정확히 같은 요청뿐 아니라 의미적으로 유사한 요청도 캐시 히트로 처리하는 퍼지 매칭이 핵심 차별점이다.

포트폴리오용 프로젝트이며, 개발 완료 후 `benchmark/` 도구로 실제 토큰 절감량을 수치로 검증한다.

## 2. 기술 스택

| 구분 | 기술 |
|---|---|
| MCP 서버 | TypeScript + `@airmcp-dev/core` (`defineServer`, `defineTool`) |
| 임베딩 서비스 | Python + FastAPI + `multilingual-e5-base` (768차원, ~1.1GB, HNSW 코사인 유사도) |
| 벡터/데이터 저장소 | PostgreSQL 16 + pgvector (HNSW 인덱스) |
| 컨테이너 | Docker Compose (mcp-server / embedding-service / postgres, 3개 서비스) |

컨테이너 이미지: `mcp-server` → `node:20-slim`, `embedding-service` → `python:3.11` + torch, `postgres` → `pgvector/pgvector:pg16`.

## 3. 프로젝트 구조

```
smart-cache-mcp/
├── CLAUDE.md
├── README.md                # 포트폴리오용 개요 (GitHub 첫 화면에 노출)
├── docker-compose.yml
├── .env.example
├── .gitignore
├── mcp-server/              # Node.js MCP 프록시 서버
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   ├── src/
│   │   ├── index.ts              # 서버 진입점 (defineServer, sse transport)
│   │   ├── tools/                # cached_call, register_mcp, cache_stats, cache_clear, cache_config
│   │   ├── proxy/                # 하위 MCP 서버 연결, JSON-RPC 중계
│   │   ├── cache/                # 캐시 조회/저장/TTL/교체 정책
│   │   ├── embedding/            # 임베딩 서비스 HTTP 클라이언트
│   │   └── db/                   # PostgreSQL + pgvector 연결/쿼리
│   └── test/
│       ├── unit/                 # DB/네트워크 불필요 (hash, ttl)
│       ├── integration/          # postgres/embedding-service/mcp-server 필요
│       └── helpers/              # 공용 다운스트림 MCP 테스트 서버 픽스처
├── embedding-service/       # Python 임베딩 서버
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── requirements-dev.txt      # pytest, httpx (이미지에는 미포함)
│   ├── pytest.ini
│   ├── app.py                    # FastAPI, multilingual-e5-base 서빙
│   └── tests/
│       └── test_app.py
├── db/
│   └── init.sql                  # PostgreSQL 스키마 (cache_entries, mcp_registry, cache_logs)
└── benchmark/                # 토큰 절감 검증
    ├── package.json
    ├── tsconfig.json
    ├── downstream-server.ts      # 벤치마크용 목업 지식조회 MCP 서버
    ├── scenarios/                # 테스트 시나리오 JSON (4개)
    ├── run_benchmark.ts          # 벤치마크 실행
    ├── report.ts                 # 결과 리포트 생성 (마크다운)
    └── REPORT.md                 # 생성된 최신 벤치마크 결과 (커밋 대상)
```

## 4. 빌드/실행 명령어

```bash
# 전체 스택 빌드 + 기동
docker-compose up --build

# 백그라운드 기동
docker-compose up --build -d

# 로그 확인
docker-compose logs -f mcp-server
docker-compose logs -f embedding-service

# 중지 (볼륨 유지)
docker-compose down

# 중지 + 볼륨 삭제 (DB 초기화)
docker-compose down -v

# 개별 서비스 재빌드
docker-compose up --build mcp-server
```

토큰 절감 벤치마크 (docker-compose가 떠 있는 상태에서, 호스트에서 실행):
```bash
cd benchmark
npm install    # 최초 1회
npm run benchmark
# → benchmark/REPORT.md 갱신
```

로컬 개발 시 (컨테이너 밖):
```bash
# mcp-server
cd mcp-server && npm install && npm run dev

# embedding-service
cd embedding-service && pip install -r requirements.txt && uvicorn app:app --reload --port 8000
```

## 5. 핵심 설정값

이 값들은 스펙으로 고정되어 있으며 임의로 변경하지 않는다 (변경 필요 시 사용자에게 먼저 확인).

- **코사인 유사도 임계값**: `0.90` (e5 모델 유사도가 0.7~1.0에 밀집되는 특성상 0.85는 오탐 위험이 있어 보수적으로 채택. `cache_config`로 런타임 조정 가능)
- **TTL 매핑** (importance → TTL):

  | importance | TTL | 데이터 성격 |
  |---|---|---|
  | 1 (매우 낮음) | 5분 | 실시간 데이터 (주가, 실시간 트래픽) |
  | 2 (낮음) | 30분 | 자주 바뀌는 정보 (날씨, 환율) |
  | 3 (보통) | 2시간 | 일반 조회 결과 (검색, 뉴스) |
  | 4 (높음) | 24시간 | 잘 안 바뀌는 정보 (문서, 위키피디아) |
  | 5 (매우 높음) | 48시간 | 거의 불변 (수학 공식, 정의, 상수) |

- **캐시 교체(eviction) 우선순위 점수 공식**:
  ```
  priority_score = importance × log2(hit_count + 2) × recency_weight
  ```
  - `importance`: AI가 매긴 중요도 (1~5)
  - `log2(hit_count + 2)`: 히트 횟수 로그 스케일링 (선형 증가 방지 — 저중요도 항목이 히트 수만으로 고중요도 항목을 압도하는 것을 막음)
  - `recency_weight`: 마지막 접근 시간 기반 감쇠값 (0~1)
  - 제거 순서: 1순위 TTL 만료 항목 → 2순위 priority_score 최저 항목
- **캐시 용량**: `CACHE_MAX_ENTRIES`(기본 50,000건) **개수 기준으로만** 교체가 트리거된다. 기획서 2장 표는 "256MB / 50,000건"을 나란히 제시하지만, 실제 동작을 규정하는 6.1절은 "50,000건에 도달하면"이라고만 되어 있어 개수만 트리거 조건임을 확인함 — `CACHE_MAX_SIZE_MB`(`.env`, 기본 256)는 정의만 되어 있고 `eviction.ts`가 읽지 않는 **미사용(dead) 설정값**이다 (2026-07-14 감사에서 발견, 문서만 정직하게 정정하기로 함 — 실제 바이트 용량 기반 교체를 구현하려면 별도 작업 필요)
- **e5 임베딩 프리픽스**: 저장 시 `"passage: ..."`, 조회 시 `"query: ..."` — 프리픽스 없이 사용 시 유사도가 전반적으로 낮게 측정되므로 반드시 자동 부착 (프리픽스는 호출자, 즉 mcp-server 쪽에서 붙이고 embedding-service는 받은 텍스트를 그대로 임베딩)
- **임베딩 차원**: `768` (`intfloat/multilingual-e5-base` 실제 hidden size 기준. 기획서에는 일부 표에 384로 기재되어 있었으나, 이는 `multilingual-e5-small`의 스펙이며 모델명·용량(1.1GB)은 base 모델과 일치해 base+768차원으로 확정함 — 2026-07-14 사용자 확인)

### embedding-service `/embed` API (2단계에서 확정된 내부 계약)

```
POST /embed
Body:     { "texts": string[] }   # 프리픽스는 호출자가 미리 붙여서 전달
Response: { "embeddings": number[][], "model": string, "dimensions": 768 }
```

`sentence-transformers`의 `normalize_embeddings=True`로 L2 정규화된 벡터를 반환하므로, pgvector `<=>` 코사인 거리 연산과 바로 호환된다. 모델 가중치는 Docker 빌드 시 `prefetch_model.py`로 이미지에 baked-in 되어 런타임에 인터넷 접근이 필요 없다.

### mcp-server `proxy/` 모듈 (3단계에서 확정)

- 하위 MCP 서버 연결에는 `@airmcp-dev/gateway`를 쓰지 않고, `@modelcontextprotocol/sdk`의 `Client` + `StreamableHTTPClientTransport`를 직접 사용한다. gateway는 "같은 도구를 제공하는 여러 인스턴스 간 로드밸런싱/헬스체크"가 핵심 가치인데, 우리 `mcp_registry`는 별칭 1개 = 엔드포인트 1개의 단순 매핑이라 모델이 맞지 않아 채택하지 않음 (2026-07-14 사용자 확인)
- `src/proxy/client.ts`: 엔드포인트별로 `Client` 연결을 `Map`에 캐싱해 재사용. 호출 실패 시 `dropClient()`로 캐시에서 제거해 다음 호출이 재연결하도록 함
- `src/proxy/relay.ts`: `callDownstreamTool(endpoint, toolName, args)` — 연결/프로토콜 실패는 `DownstreamMcpError`로 감싸서 던짐 (도구 실행 자체의 에러는 MCP 스펙대로 `CallToolResult.isError: true`로 정상 반환되므로 그대로 통과)
- 다운스트림 서버 transport는 Streamable HTTP 하나만 지원 (SSE 등 레거시 transport는 미지원 — 필요해지면 별도 논의)

### mcp-server `cache/` · `db/` · `embedding/` 모듈 (4단계에서 확정)

**모듈 구성**
- `src/db/pool.ts`: `pg.Pool` (DATABASE_URL 기반)
- `src/db/cache-entries.ts`: `cache_entries` CRUD — 유사도 검색(`findBySimilarity`), 해시 검색(`findByHash`), 삽입/히트 갱신/카운트/만료삭제/우선순위삭제. `priority_score` 계산 SQL도 여기 위치 (DB 전용 관심사라 `cache/`가 아닌 `db/`에 둠)
- `src/db/cache-logs.ts`: `cache_logs`에 조회 이력 기록 (5단계 `cache_stats`가 그대로 소비)
- `src/embedding/client.ts`: `/embed` HTTP 클라이언트. `embedQuery`/`embedPassage`가 각각 `query:`/`passage:` 프리픽스를 붙임. 실패 시 `EmbeddingServiceError`
- `src/cache/hash.ts`: 인자 정규화(키 정렬) + SHA-256 해시 + 캐시 텍스트 조합(`tool_name + arguments`) + advisory lock 키 파생
- `src/cache/ttl.ts`: importance(1~5) → TTL(초) 매핑, `.env`의 `CACHE_TTL_IMPORTANCE_*` 오버라이드 지원
- `src/cache/stampede.ts`: `pg_advisory_xact_lock`으로 (tool_name, arguments_hash) 단위 락 — 트랜잭션이 끝나면 자동 해제되므로 세션 락 수동 해제 로직 불필요
- `src/cache/eviction.ts`: `maybeEvict()` — 카운트가 `CACHE_MAX_ENTRIES` 이상이면 만료분 먼저 삭제 후 `priority_score` 최저부터 삭제. **전역(全 tool_name) 카운트 기준**이며 tool별로 나뉘지 않음 (기획서 6.1 그대로)
- `src/cache/cached-call.ts`: `executeCachedCall()` — proxy/embedding/db/eviction/stampede를 엮은 오케스트레이션. 기획서 3.4 Step 1~5를 그대로 구현

**중요한 설계 결정**
- **런타임 설정 재조회**: `CACHE_SIMILARITY_THRESHOLD`, `CACHE_MAX_ENTRIES`는 모듈 로드 시점이 아니라 호출 시점에 `process.env`를 읽는다 (함수로 감쌈). 5단계에서 만들 `cache_config` 도구가 프로세스 재시작 없이 값을 바꿀 수 있어야 하기 때문 — 초기 구현에서 module-level 상수로 뒀다가 테스트 중 발견하고 수정함
- **엔드포인트 별칭 해석은 cache/ 밖에서**: `cached_call`의 `endpoint` 파라미터가 별칭인지 실제 URL인지 판단하는 로직(= `mcp_registry` 조회)은 5단계 `cached_call` 도구 핸들러의 책임이고, `executeCachedCall()`은 이미 해석된 URL만 받는다
- **stale-while-revalidate는 "항상 stale 우선 반환"이 아니라 "원본 호출 실패 시에만" 폴백**: 기획서 8.3이 "원본 MCP 장애 → 호출 실패 → stale 반환"이라는 순서로 서술되어 있어, 이를 그대로 따름 (TTL 만료 시 무조건 stale부터 주고 백그라운드 갱신하는 방식이 아님). stale 폴백은 해시 정확매칭으로만 조회 (재임베딩 없이 단순화)
- **토큰 절감 추정치**: `Math.ceil(JSON.stringify(value).length / 3)` — 기획서 9장 검증표의 "len(json)/3 근사치" 그대로
- **정확 일치 시 similarity**: 해시 폴백/스테일 폴백 히트는 코사인 유사도가 없으므로 `similarity: 1`(해시 폴백) 또는 `similarity: null`(스테일 폴백)로 응답

**퍼지 매칭 관련 발견 (7단계 벤치마크에서 정식으로 다룰 사항)**: 검증 중 `roll_dice {"sides":6}`와 `{"sides":100}`처럼 tool_name+인자 JSON이 거의 동일한 텍스트인 경우, 서로 다른 호출인데도 코사인 유사도가 0.90을 넘어 오탐(다른 인자인데 캐시 히트)이 발생할 수 있음을 확인. 기획서 3.2가 이미 예상한 종류의 리스크(0.90도 완벽하지 않음)이며, 구조적으로 유사한 숫자형 인자를 쓰는 도구는 특히 주의 필요 — 임계값 조정이나 인자 구조를 임베딩 텍스트에 더 명시적으로 반영하는 방안은 필요 시 논의

**Windows 포트 충돌 (개발 환경 이슈, 기록용)**: 이 개발 머신에는 Windows 네이티브 PostgreSQL 서비스가 두 개(`postgresql-x64-17`, `postgresql-x64-18`) 설치되어 있어 5432/5433을 이미 점유하고 있었다. Docker Desktop(WSL2)이 `docker compose ps`에는 포트가 매핑된 것처럼 표시해도, 실제로는 네이티브 서비스가 연결을 가로채 엉뚱한 인증 실패를 반환하는 문제가 있었다 (컨테이너의 postgres 로그에는 연결 시도 자체가 찍히지 않음). 완전히 비어있는 포트(15432)로 바꿔서 해결 — `.env`/`.env.example`/`docker-compose.yml` 모두 반영됨. 다른 개발 환경에서는 필요 없을 수 있는 조치.

### 장애 대응
- **캐시 스탬피드**: PostgreSQL Advisory Lock으로 동일 키 동시 요청 시 중복 원본 호출 방지, 대기 후 결과 공유
- **임베딩 서비스 장애**: `arguments_hash`(SHA-256) 기반 정확 매칭으로 폴백 (퍼지 매칭 불가, 서비스는 유지)
- **원본 MCP 장애 / stale-while-revalidate**: TTL 만료 캐시라도 즉시 반환(`stale: true`) 후 백그라운드에서 갱신, 원본 미응답 시 에러보다 stale 데이터 우선

### mcp-server `tools/` 모듈 및 서버 진입점 (5단계에서 확정)

- `src/index.ts`: `@airmcp-dev/core`의 `defineServer({ transport: { type: "sse", port } })`로 실제 MCP 서버 기동 (**`"http"`가 아니라 `"sse"`** — 아래 "known framework limitation" 참고). 5개 도구를 모두 등록
- `src/tools/resolve-endpoint.ts`: `cached_call`의 `endpoint` 파라미터가 `http(s)://`로 시작하면 그대로, 아니면 `mcp_registry`에서 별칭으로 조회 — 못 찾으면 에러
- `src/tools/cached-call.ts`: `arguments`(JSON 문자열) 파싱 → 별칭 해석 → `executeCachedCall()` 호출 → `{result, cache_hit, similarity, tokens_saved, stale}` 반환 (기획서 4.1 응답 필드 그대로)
- `src/tools/register-mcp.ts`: `mcp_registry` upsert (`ON CONFLICT (alias) DO UPDATE`)
- `src/tools/cache-stats.ts`: 총 항목수/용량(`pg_total_relation_size`)/전체 히트율/누적 절감 토큰/도구별 히트율 top5/최다 히트 쿼리 top5 (기획서 4.3 항목 모두 포함)
- `src/tools/cache-clear.ts`: `target`을 "all" → 전체 삭제, 등록된 별칭이면 해당 `mcp_endpoint`로 삭제, 그 외에는 `tool_name`으로 간주해 삭제 — 이 우선순위로 판별
- `src/tools/cache-config.ts`: `max_entries`/`similarity_threshold`/`ttl_map`을 받아 **`process.env`에 직접 기록**. 4단계에서 이미 관련 getter들을 "호출 시점에 `process.env` 재조회"하도록 만들어뒀기 때문에, 별도 설정 저장소 없이 즉시 런타임 반영됨 (프로세스 재시작 불필요)

**MCP 서버 헬스체크 경로 변경**: `defineServer`는 `/health`가 아니라 **`GET /`** 가 서버 상태 JSON을 반환한다 (`{name, state: "running", toolCount, ...}`, http/sse transport 공통). 1~4단계에서 쓰던 수동 `/health` 엔드포인트는 제거되었으므로 `docker-compose.yml`의 healthcheck도 `GET /`로 변경함.

**`@airmcp-dev/core` 0.3.0 known framework limitation — http transport는 세션을 1개만 지원함 (6단계에서 발견, 중요)**: `transport: { type: "http" }`로 기동하면 `defineServer`는 프로세스 생애주기 동안 단 하나의 `McpServer` 인스턴스를 하나의 `StreamableHTTPServerTransport`에 연결한다. 첫 번째 클라이언트가 정상적으로 initialize 핸드셰이크를 마치고 나면, **`transport.terminateSession()`으로 세션을 명시적으로 종료해도** 이후 어떤 새 클라이언트도 `"Invalid Request: Server already initialized"` 에러로 영구히 거부된다 — 컨테이너를 재시작하기 전까지 회복 불가. 실제 배포에서 AI 클라이언트가 재접속(예: 대화 새로 시작, 클라이언트 재시작)하면 서버가 먹통이 되는 심각한 문제라 그냥 넘어가지 않고 확인함:
- `transport: { type: "sse" }`로 바꾸면 `server-runner.js`의 SSE 분기가 **세션마다 새 `McpServer` 인스턴스**를 만들어 등록하기 때문에 이 문제가 없음 — 연속 3개 세션으로 직접 재현/검증 완료 (2026-07-14, 사용자 확인 후 채택)
- 최신 버전(npm 기준 0.3.0이 최신)에도 존재하는 이슈이므로 라이브러리 업그레이드로는 해결 안 됨
- 대가: MCP 엔드포인트가 `POST /mcp`(Streamable HTTP)가 아니라 `GET /sse` + `POST /message?sessionId=...`(SSE, 구형이지만 여전히 널리 지원되는 transport)가 됨. 클라이언트 쪽에서는 `StreamableHTTPClientTransport` 대신 `SSEClientTransport`를 사용해야 함
- 우리 자신의 하위 MCP 연결(proxy/client.ts, 3단계)은 이 이슈와 무관 — 그건 우리가 클라이언트로서 Streamable HTTP를 쓰는 것이고, 이번 이슈는 우리가 서버로서 노출하는 transport 얘기임

**검증 시 발견한 MCP SDK 기본 보안 동작 (개발/테스트 시 참고)**: `@modelcontextprotocol/sdk`의 `createMcpExpressApp()`은 기본적으로 DNS 리바인딩 방지 미들웨어를 켜고 `Host` 헤더가 `localhost`/`127.0.0.1`/`::1`가 아니면 403을 반환한다. 도커 컨테이너 안에서 호스트 머신의 서비스를 부를 때는 `host.docker.internal`을 쓰게 되는데, 이 미들웨어를 그대로 두면 막힌다 — `allowedHosts` 옵션에 **포트 없이** 호스트명만 추가해야 한다 (`hostHeaderValidation`이 포트를 무시하고 hostname만 비교함). 우리 실제 배포용 코드는 이 미들웨어를 쓰지 않지만(우리는 다운스트림 MCP 서버의 구현이 아니라 클라이언트일 뿐), 로컬에서 다운스트림 MCP를 직접 만들어 테스트할 때 자주 걸리는 부분이라 기록.

### `benchmark/` 모듈 (7단계에서 확정)

**측정 방법론**: `benchmark/downstream-server.ts`는 8개 주제(AI/ML/딥러닝/파이썬 정렬/도커/쿠버네티스/날씨/DB 인덱스)에 대해 결정론적인 실제 크기의 답변을 반환하는 목업 지식조회 MCP 서버다 (질문마다 랜덤 값을 주던 mcp-server 테스트 픽스처와 달리, 벤치마크는 "같은 주제 질문엔 같은 답"이 실제 API에 가까움). 각 시나리오마다:
1. `cache_clear(all)`로 캐시를 비우고 시작 (시나리오 간 독립성 보장)
2. **"캐시 미사용" 패스**: 모든 질의를 다운스트림에 **직접** 호출 (우리 mcp-server를 거치지 않음) — 매번 실측한 토큰/지연시간이 진짜 기준선
3. **"캐시 사용" 패스**: 같은 질의를 `cached_call`을 통해 호출 — `cache_hit`/`tokens_saved`/지연시간을 그대로 집계
4. 절감률은 시스템이 자체 신고하는 `tokens_saved`가 아니라, 1번 패스에서 독립적으로 측정한 기준선 대비로 계산

**검증 중 발견/수정한 버그**: 처음 돌렸을 때 절감률이 107.8%처럼 100%를 넘는 값이 나왔다. 원인은 "캐시 미사용" 토큰을 `cached_call` 응답에서 파싱해 꺼낸 **내부 JSON**(`{answer, topic, ...}`)으로 셌는데, 시스템이 내부적으로 계산하는 `tokens_saved`는 **`CallToolResult` 전체 envelope**(`{content: [...]}`)를 기준으로 하고 있어 두 값의 기준(scale)이 달랐던 것 — baseline 측정도 raw `CallToolResult`를 기준으로 통일해서 해결함 (`run_benchmark.ts`의 `estimateTokens(rawResult)` 참고).

**시나리오 1(동일 질의 반복)의 기대 히트율은 90%가 정상**: 캐시가 매번 비어있는 상태로 시작하므로 첫 호출은 항상 미스 — 10회 중 9회(반복 호출) 전부 히트하면 그게 최선의 결과다. "100% 목표"라는 기획서 문구는 반복 호출 9건 기준으로 해석함.

**실측 결과 요약 (2026-07-14 기준)**: 전체 히트율 65.2%(30/46), 토큰 절감률 64.9%. 시나리오 2(유사 질의 변형)는 80% 히트, 시나리오 3(다국어)은 50% 히트 — 완전히 다른 텍스트(정확히 같은 문자열이 하나도 없음)인데도 5/10이 히트했다는 것은 cross-lingual 퍼지 매칭이 부분적으로 작동함을 보여줌 (100%는 아님 — 임계값 0.90을 못 넘는 언어쌍도 있었다는 뜻).

**지연시간 결과는 있는 그대로 보고함 — 캐시 hit가 기준선보다 느리게 나옴**: 목업 다운스트림이 인메모리 조회라 사실상 무시할 수준(1.5~3ms)인 반면, 캐시 hit는 임베딩 서비스 호출 + pgvector 검색이라는 실제 네트워크 왕복(~15ms)이 든다. 이건 벤치마크 버그가 아니라 목업이 비현실적으로 가볍기 때문 — 실제 세계의 무거운 원본 MCP(검색 API, LLM 호출 등)라면 캐시 hit가 지연시간도 함께 줄여줄 것으로 예상되지만, 이 벤치마크는 그 가정을 검증하지 않았다는 점을 리포트에 명시해뒀다 (`benchmark/REPORT.md` "지연시간에 대한 솔직한 해석" 참고).

## 6. 개발 컨벤션

- TypeScript는 `strict` 모드 필수 (`tsconfig.json`에서 `"strict": true`)
- ESLint 규칙 준수, 커밋 전 린트 통과
- **코드 내 주석은 한국어 금지 — 영어로 작성**. 코드, 식별자, 커밋 메시지, 주석 모두 영어
- 이 CLAUDE.md 및 사용자와의 대화는 한국어로 유지 (코드/주석과는 별개)
- 기획서(`smart-cache-mcp-proposal.docx`)에 명시되지 않은 사항은 임의로 추가하지 않고 먼저 사용자에게 확인

## 7. 테스트 방법

- **부팅 확인 (1단계 완료, 아래 내용은 1단계 시점 기록 — mcp-server 확인 경로는 이후 단계에서 바뀌었으니 지금 재현하려면 다음 항목 참고)**: `docker-compose up --build` 후 3개 컨테이너 모두 `healthy` 상태 확인됨
  - `mcp-server`: `GET http://localhost:3000/health` → `{"status":"ok"}` (Node 내장 `http` 모듈, MCP 프레임워크는 3단계에서 도입) — **지금은 이 경로가 없다.** `/health` → 5단계에 `GET /`(상태 JSON)로 교체 → 6단계에 SSE 전환으로 엔드포인트 자체가 `GET /sse`가 됨. 현재 헬스체크는 `docker-compose.yml`의 `GET /` 그대로이고, 실제 MCP 접속은 `/sse`로 한다 (5·6단계 절 참고)
  - `embedding-service`: `GET http://localhost:8000/health` → `{"status":"ok"}` (FastAPI 스텁, 실제 모델 로딩은 2단계에서 구현) — 이 경로는 지금도 그대로 유효함
  - `postgres`: `cache_entries` / `mcp_registry` / `cache_logs` 테이블 및 HNSW 인덱스(`idx_cache_embedding`) 생성 확인됨 (`db/init.sql`)
- **임베딩 검증 (2단계 완료)**: `POST http://localhost:8000/embed` `{"texts": [...]}` → 768차원 벡터 반환. GPU 로그로 `cuda available: True` 확인. `query:`/`passage:` 프리픽스가 붙은 의미적으로 유사한 문장 쌍의 코사인 유사도(0.88)가 무관한 문장 쌍(0.72)보다 뚜렷이 높음을 확인 — 0.90 임계값 설계가 타당함을 뒷받침
- **프록시 검증 (3단계 완료)**: 임시 다운스트림 MCP 서버(공식 SDK 예제 패턴)로 정상 호출/연결 재사용/에러 경로(`DownstreamMcpError`) 확인
- **캐시 로직 검증 (4단계 완료)**: 임시 다운스트림 서버 + 실제 postgres/embedding-service로 아래를 모두 확인 (검증 스크립트는 확인 후 삭제):
  - 동일 호출 반복 시 miss → hit, 히트가 원본 재호출 없이 저장된 결과를 그대로 반환 (`tokensSaved > 0`, `similarity >= 0.90`)
  - 새 키에 대한 동시 호출 5개가 다운스트림을 정확히 1번만 호출 (`pg_advisory_xact_lock` 스탬피드 방지)
  - 원본 MCP가 죽었을 때 만료된 캐시를 `stale: true`로 정상 반환
  - `CACHE_MAX_ENTRIES` 초과 시 우선순위 최저 항목부터 삭제, 중요도/히트수 높은 항목은 생존
  - embedding-service를 실제로 내렸을 때 SHA-256 해시 폴백으로 정확 매칭 히트가 계속 동작
- **도구 E2E 검증 (5단계에서 처음 확인, 6단계에서 정식 테스트로 격상)**: 실제 `@modelcontextprotocol/sdk` `Client`로 우리 mcp-server에 접속해 5개 도구를 모두 실제 MCP 프로토콜을 통해 호출 확인 (`listTools`로 5개 전부 노출 확인 → `register_mcp`로 별칭 등록 → `cached_call`을 별칭으로 호출해 miss/hit → `cache_stats`가 방금 호출을 반영 → `cache_config`로 유사도 임계값 즉시 변경 → `cache_clear`로 도구명 기준 삭제)
- **단위/통합 테스트 (6단계 완료)**: `mcp-server`는 vitest, `embedding-service`는 pytest로 정식 스위트 정리. 아래 "테스트 실행" 참고. `docker compose up`이 떠 있는 상태에서 여러 번 반복 실행해도 안정적으로 통과함을 확인 (세션 재사용 문제 등 재현성 이슈 없음 — SSE 전환 이후)
- **벤치마크 검증 (7단계 완료)**: `cd benchmark && npm run benchmark` → `benchmark/REPORT.md` 생성. 4개 시나리오(동일 반복/유사 변형/다국어/혼합 워크로드) 실행 결과: 전체 히트율 65.2%(30/46), 토큰 절감률 64.9%. "캐시 미사용" 토큰도 자체 신고가 아니라 다운스트림을 매번 직접 호출해 독립 측정 — 상세 방법론은 아래 "benchmark/ 모듈" 참고

### 테스트 실행

```bash
# mcp-server: docker compose up이 떠 있는 상태에서 (호스트에서 실행, 컨테이너 밖)
cd mcp-server
npm run test:unit          # DB/네트워크 불필요 (hash, ttl 로직)
npm run test:integration   # postgres(15432)/embedding-service(8000)/mcp-server(3000) 필요
npm test                   # 전체

# embedding-service: 컨테이너 안에 torch/모델이 있으므로 컨테이너 안에서 실행
docker compose cp embedding-service/tests embedding-service:/app/tests
docker compose cp embedding-service/pytest.ini embedding-service:/app/pytest.ini
docker compose cp embedding-service/requirements-dev.txt embedding-service:/app/requirements-dev.txt
docker compose exec embedding-service pip install -r requirements-dev.txt
docker compose exec embedding-service pytest -v
```

`mcp-server`의 통합 테스트는 `test/helpers/downstream-server.ts`(공식 SDK 기반, 임의의 tool_name을 받아주는 범용 다운스트림 MCP 서버 픽스처)를 공유해서 쓴다. `test/integration/cache-hash-fallback.test.ts`는 실제로 embedding-service 컨테이너를 내리는 대신 `vi.mock`으로 `EmbeddingServiceError`를 강제 발생시켜 폴백 분기를 결정론적으로 검증한다 (컨테이너를 내려야 하는 4단계 수동 검증 방식보다 반복 가능함).

## 8. 환경변수 (.env)

`.env.example` 참고. 주요 키:

| 키 | 설명 |
|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | PostgreSQL 접속 정보 |
| `POSTGRES_PORT` | 호스트에 게시되는 PostgreSQL 포트 (기본 **15432**, 컨테이너 내부 포트는 5432 그대로). Windows + Docker Desktop(WSL2) 환경에서 5432/5433이 로컬에 이미 설치된 PostgreSQL 서비스와 충돌해 의도적으로 특이한 포트를 사용 — 아래 "Windows 포트 충돌" 참고 |
| `DATABASE_URL` | mcp-server가 사용하는 전체 접속 문자열 |
| `MCP_SERVER_PORT` | mcp-server 리슨 포트 (기본 3000) |
| `MCP_AUTH_TOKEN` | 설정 시 5개 도구 전부에 bearer 토큰 인증 강제 (미설정 시 인증 없음, 기본값). 도구 파라미터 `_auth`로 전달 — 10장 "사후 개선" 참고 |
| `EMBEDDING_SERVICE_URL` | mcp-server → embedding-service 호출 URL |
| `EMBEDDING_SERVICE_PORT` | embedding-service 리슨 포트 (기본 8000) |
| `EMBEDDING_MODEL_NAME` | 사용 임베딩 모델 (`intfloat/multilingual-e5-base`) |
| `EMBEDDING_DEVICE` | `cuda` 또는 `cpu` (RTX 3060 사용 시 `cuda`) |
| `CACHE_SIMILARITY_THRESHOLD` | 퍼지 매칭 유사도 임계값 (기본 0.90) |
| `CACHE_MAX_ENTRIES` | 최대 캐시 항목 수 (기본 50000) — 교체 정책의 실제 트리거 조건 |
| `CACHE_MAX_SIZE_MB` | 기본 256, **현재 미사용(dead config)**. `eviction.ts`가 읽지 않아 어떤 동작에도 영향을 주지 않는다 — 5장 "캐시 용량" 참고 |
| `CACHE_TTL_IMPORTANCE_1` ~ `CACHE_TTL_IMPORTANCE_5` | 중요도별 TTL(초). 기본값은 5장 TTL 매핑 표와 동일 (300/1800/7200/86400/172800) |
| `LOG_LEVEL` | 로그 레벨 (`debug`/`info`/`warn`/`error`) |
| `NODE_ENV` | `development` / `production` |

## 9. 개발 순서 및 진행 상태

- [x] **0단계**: CLAUDE.md, .env.example, .gitignore, docker-compose.yml, 디렉토리 구조 생성
- [x] **1단계**: Docker Compose + DB 스키마 + 기본 서버 기동 확인 (`db/init.sql` 스키마 적용, `mcp-server`/`embedding-service` 헬스체크 엔드포인트로 3개 컨테이너 모두 healthy 확인)
- [x] **2단계**: 임베딩 서비스 (FastAPI + e5 모델 로딩 + `/embed` 엔드포인트, CUDA 확인됨, 빌드 시 모델 프리페치로 런타임 인터넷 불필요)
- [x] **3단계**: MCP 프록시 로직 (`@modelcontextprotocol/sdk` `Client` + `StreamableHTTPClientTransport`로 하위 MCP 서버 연결, JSON-RPC 중계. 임시 다운스트림 서버로 정상 호출/에러 경로 모두 검증 후 정리)
- [x] **4단계**: 캐시 로직 (벡터 검색, TTL, 교체 정책, 스탬피드 방지, 임베딩 폴백, stale-while-revalidate — 모두 실제 다운스트림 서버로 검증)
- [x] **5단계**: 5개 도구 구현 (`cached_call`, `register_mcp`, `cache_stats`, `cache_clear`, `cache_config` — `@airmcp-dev/core`의 `defineServer`/`defineTool`로 실제 MCP 서버 구성, 실제 MCP 클라이언트로 E2E 검증 완료)
- [x] **6단계**: 통합 테스트 (`mcp-server` vitest 23개 — unit + integration, `embedding-service` pytest 4개. `@airmcp-dev/core` http transport의 세션 재사용 불가 버그를 발견해 `sse` transport로 전환)
- [x] **7단계**: 벤치마크 구현 및 토큰 절감 검증 → `benchmark/REPORT.md` (전체 히트율 65.2%, 토큰 절감률 64.9% 실측)

**전체 7단계 개발 완료.** 각 단계 완료 시 `docker-compose up --build`로 정상 기동을 확인하며 진행했다.

## 10. 사후 개선 (냉철 평가 피드백 반영, 2026-07-14)

7단계 완료 후 프로젝트를 다방면으로 냉정하게 재평가한 결과 발견된 3가지 우선순위를 실제로 반영함:

- **ESLint 실제 도입**: `CLAUDE.md`에 "ESLint 규칙 준수"라고 문서화만 해두고 실제 설정 파일이 없던 상태였다 (문서-코드 괴리). `mcp-server/eslint.config.js`(flat config, `typescript-eslint` recommended)를 추가하고 `npm run lint` 스크립트로 연결. 기존 코드는 위반 0건으로 통과했지만, 새로 추가한 `ssrf-guard.ts`에서 `preserve-caught-error` 룰이 실제로 catch한 에러의 cause 체인을 안 살리고 있던 것을 잡아냄 (수정함) — 룰이 실제로 유용했다는 증거
- **`register_mcp` SSRF 방어 추가**: `src/tools/ssrf-guard.ts`에 사설/루프백/링크로컬 대역(127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16 — 클라우드 메타데이터 엔드포인트 포함 — 및 IPv6 대응 대역) 판별 로직을 추가하고 `register_mcp` 핸들러에서 호출. **`NODE_ENV === "production"`일 때만 강제**하도록 게이팅함 — `host.docker.internal`/`localhost`로 로컬 다운스트림을 등록하는 개발·테스트 워크플로(`.env.example` 기본값은 `development`)를 깨뜨리지 않으면서, 실제 배포 시나리오에서만 방어가 걸리도록 함. 유닛 테스트(`test/unit/ssrf-guard.test.ts`)와 실제 도커 환경에서의 통합 테스트로 기존 흐름이 안 깨졌음을 확인
- **GitHub Actions CI 추가**: `.github/workflows/ci.yml` — lint+build+unit 테스트는 인프라 없이 바로 실행, integration 잡은 실제로 `docker compose up`으로 3개 컨테이너를 띄우고 살아있는 mcp-server를 상대로 vitest 통합 테스트 + embedding-service pytest까지 돌림. GPU 없는 러너 대응으로 `docker-compose.ci.yml`(`deploy: !reset null`로 nvidia 디바이스 예약만 제거하는 오버레이)을 추가 — `embedding-service/app.py`가 CUDA 미가용 시 자동으로 CPU 폴백하도록 이미 짜여 있어서 이 오버레이 하나로 충분함. 로컬에서 오버레이 적용 후 전체 스택 기동 + `npm test`(29개) + pytest(4개) 모두 통과 확인
  - 이 검증 과정에서 **`requirements-dev.txt` 자체가 컨테이너에 복사되지 않아 pytest 설치가 실패하는 버그**를 발견함 — 8장 "테스트 실행" 절의 기존 안내와 CI 워크플로 둘 다 `docker compose cp embedding-service/requirements-dev.txt ...` 스텝이 빠져 있었음 (6단계에서 처음 pytest를 셋업할 때는 `pip install pytest==... httpx==...`를 직접 실행해서 이 경로를 안 탔던 것으로 추정). 두 곳 모두 수정함

이어서 "실서비스 준비도/보안" 카테고리에서 지적받은 나머지 항목(인증, 레이트리밋) 중 실제로 구현 가능한 부분을 반영함:

- **선택적 토큰 인증 (`MCP_AUTH_TOKEN`)**: `@airmcp-dev/core`의 내장 `authPlugin`을 채택. 이 플러그인은 **HTTP 헤더가 아니라 도구 파라미터** 기반 인증이라(`before` 미들웨어가 `ctx.params[paramName]`을 검사), `src/tools/auth.ts`에서 `MCP_AUTH_TOKEN` env가 설정된 경우에만 5개 도구 전부의 `params`에 `_auth: z.string()`을 스프레드해 넣고, `index.ts`에서 `use: [authPlugin({ type: "bearer", keys: [...] })]`을 조건부로 등록. **`MCP_AUTH_TOKEN` 미설정 시 완전히 비활성** — SSRF 가드와 동일하게 로컬 zero-config 개발 흐름을 깨지 않는 옵트인 방식
- **전역 레이트리밋 + 위협탐지 + 감사로그 (`shield`)**: `authPlugin`과 별개로 `defineServer({ shield: {...} })` 내장 옵션을 항상 켜둠 — 프롬프트 인젝션/명령어 인젝션/경로 순회 패턴을 도구 파라미터에서 정규식으로 탐지하고, 도구별 전역 레이트리밋(기본 60회/분, `cached_call`은 120회/분으로 넉넉하게, 파괴적 동작인 `cache_clear`는 5회/분으로 타이트하게), 모든 allow/deny 판정을 감사 로그로 남김. `perUserRateLimitPlugin`(파라미터로 사용자를 식별하는 방식)이 아니라 `shield.rateLimit`(도구별 전역 카운터)을 선택한 이유는 우리 유스케이스가 "이 서버 전체를 남용으로부터 보호"이지 "사용자별 쿼터"가 아니기 때문
- **실제 라이브 검증 (임시 스크립트, 확인 후 삭제)**: `.env`에 `MCP_AUTH_TOKEN`을 임시로 채우고 컨테이너를 재기동해, 실제 MCP 클라이언트로 (1) `_auth` 없이 호출 → 스키마 검증 단계에서 거부, (2) 틀린 토큰으로 호출 → `authPlugin`이 거부, (3) 맞는 토큰 → 정상 처리, (4) `cache_clear`를 6번 연속 호출 → 정확히 6번째에 레이트리밋 발동을 전부 실측 확인. 이후 `.env`를 원복하고 컨테이너를 인증 없는 기본 상태로 재기동, 전체 vitest 스위트(31개) 재통과 확인
  - 이 과정에서 **`authPlugin`이 거부할 때 `abortResponse.isError: true`를 설정해도 클라이언트가 받는 `CallToolResult`에는 `isError`가 안 실리는 프레임워크 특이사항**을 발견함 (거부 메시지 텍스트 자체는 정상 전달됨) — 6단계 SSE 세션 제한과 같은 결의 발견. 클라이언트가 인증 실패를 판별하려면 `isError` 플래그가 아니라 응답 텍스트의 `[Auth]`/`[Shield]` 접두어를 봐야 함. 우리 쪽 코드에는 영향 없음(실제로 도구 실행 자체가 차단되는 보안 동작은 정상)이라 프레임워크 버전 업그레이드 전까지는 기록만 해둠
- **미반영 항목과 이유**: TLS와 다중 인스턴스(HA) 이중화는 이번에 손대지 않음. TLS는 통상 컨테이너 자체가 아니라 앞단 리버스 프록시(nginx/Caddy/Traefik)가 종단하는 게 표준 패턴이라 앱 코드 변경이 아니라 배포 토폴로지 문제이고, 로컬 단일 사용자 데모 환경에서 실제로 구동·검증할 방법이 없어 코드 변경 없이 "실배포 시 리버스 프록시로 TLS 종단" 원칙만 기록해둠. 다중 인스턴스 대응은 SSE transport 자체가 인메모리 세션 맵이라(6단계 기록 참고) 애플리케이션 계층을 다시 설계해야 하는 큰 작업이라 이번 스코프에서 제외 — 포트폴리오 프로젝트의 단일 인스턴스 전제와 맞지 않는 과잉 엔지니어링으로 판단함

## 11. 참고 문서

- 기획서 원본: `smart-cache-mcp-proposal.docx` (기획서 v2.0, 2026-07-14)
