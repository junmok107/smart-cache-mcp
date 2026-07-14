// A realistic mock "knowledge lookup" MCP server standing in for a real
// downstream MCP (e.g. a docs/FAQ search tool). Answers are deterministic
// per topic so token counts are stable and comparable across runs; the
// point of the benchmark is measuring OUR cache's behavior, not this
// server's intelligence.
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

interface Topic {
  keywords: string[];
  answer: string;
}

const KNOWLEDGE_BASE: Record<string, Topic> = {
  ai: {
    keywords: ["인공지능", "ai", "artificial intelligence"],
    answer:
      "인공지능(AI)은 인간의 학습, 추론, 지각 능력을 컴퓨터 시스템으로 구현한 기술입니다. " +
      "규칙 기반 시스템에서 시작해 통계적 기계학습을 거쳐, 최근에는 대규모 신경망 기반의 딥러닝이 " +
      "주류를 이루고 있습니다. 이미지 인식, 자연어 처리, 추천 시스템, 자율주행 등 다양한 분야에서 " +
      "활용되며, 데이터의 양과 질, 연산 자원의 발전에 힘입어 성능이 빠르게 향상되고 있습니다.",
  },
  ml: {
    keywords: ["머신러닝", "기계학습", "ml", "machine learning"],
    answer:
      "머신러닝은 명시적인 규칙을 직접 프로그래밍하지 않고, 데이터로부터 패턴을 학습해 예측이나 " +
      "판단을 수행하는 인공지능의 한 분야입니다. 지도학습, 비지도학습, 강화학습으로 크게 나뉘며, " +
      "회귀·분류·군집화 등의 문제를 다룹니다. 학습된 모델은 새로운 입력에 대해 일반화된 출력을 " +
      "내놓을 수 있어야 하며, 이를 위해 과적합 방지, 검증 데이터 분리 같은 기법이 사용됩니다.",
  },
  dl: {
    keywords: ["딥러닝", "deep learning", "신경망", "neural network"],
    answer:
      "딥러닝은 여러 층의 인공신경망을 사용해 데이터의 복잡한 패턴을 학습하는 머신러닝의 하위 " +
      "분야입니다. 합성곱 신경망(CNN)은 이미지 처리에, 순환 신경망(RNN)과 트랜스포머는 순차 " +
      "데이터·자연어 처리에 주로 쓰입니다. 대량의 데이터와 GPU 연산 자원이 뒷받침되면서 음성 인식, " +
      "번역, 생성형 AI 등에서 비약적인 성능 향상을 이끌어냈습니다.",
  },
  python_sort: {
    keywords: ["파이썬", "python", "정렬", "sort", "sorting"],
    answer:
      "파이썬에서 리스트를 정렬하려면 `list.sort()` 메서드나 내장 함수 `sorted()`를 사용합니다. " +
      "`sort()`는 리스트를 제자리에서(in-place) 정렬해 반환값이 없고, `sorted()`는 새 리스트를 " +
      "반환합니다. 두 방식 모두 `key` 매개변수로 정렬 기준 함수를 지정할 수 있고, " +
      "`reverse=True`로 내림차순 정렬이 가능합니다. 내부적으로는 병합 정렬과 삽입 정렬을 결합한 " +
      "Timsort 알고리즘을 사용해 평균 O(n log n)의 시간 복잡도를 가집니다.",
  },
  docker: {
    keywords: ["도커", "docker", "컨테이너", "container"],
    answer:
      "Docker는 애플리케이션과 그 실행 환경을 하나의 격리된 컨테이너 이미지로 패키징하는 " +
      "컨테이너화 플랫폼입니다. 가상머신과 달리 호스트 OS 커널을 공유해 훨씬 가볍고 빠르게 " +
      "기동됩니다. Dockerfile로 이미지를 정의하고, docker-compose로 여러 컨테이너를 하나의 " +
      "네트워크로 묶어 함께 실행할 수 있어 개발·배포 환경의 일관성을 보장하는 데 널리 쓰입니다.",
  },
  k8s: {
    keywords: ["쿠버네티스", "kubernetes", "k8s"],
    answer:
      "쿠버네티스(Kubernetes)는 여러 대의 서버에 걸쳐 컨테이너화된 애플리케이션의 배포, 확장, " +
      "운영을 자동화하는 오케스트레이션 플랫폼입니다. Pod, Deployment, Service 같은 리소스 " +
      "단위로 원하는 상태를 선언하면, 컨트롤러가 실제 상태를 그 목표에 맞게 지속적으로 " +
      "조정합니다. 장애 발생 시 자동 재시작, 트래픽에 따른 자동 확장(오토스케일링) 등을 " +
      "지원해 대규모 서비스 운영에 널리 사용됩니다.",
  },
  weather: {
    keywords: ["날씨", "weather", "기온", "기상"],
    answer:
      "오늘 서울의 날씨는 대체로 맑으며, 낮 최고기온은 25도, 아침 최저기온은 16도로 예상됩니다. " +
      "습도는 55% 안팎으로 쾌적한 편이고, 바람은 초속 2~3미터의 약한 바람이 불겠습니다. " +
      "자외선 지수는 '높음' 수준이므로 야외 활동 시 자외선 차단에 유의하는 것이 좋고, " +
      "저녁 이후 기온이 다소 떨어지므로 가벼운 겉옷을 챙기는 것을 권장합니다.",
  },
  db_index: {
    keywords: ["인덱스", "index", "데이터베이스", "database"],
    answer:
      "데이터베이스 인덱스는 테이블의 특정 컬럼에 대한 조회 속도를 높이기 위한 별도의 자료 " +
      "구조로, 대부분 B-tree나 해시 기반으로 구현됩니다. 인덱스를 걸면 WHERE, JOIN, ORDER BY " +
      "조건의 조회 성능이 크게 향상되지만, 쓰기(INSERT/UPDATE/DELETE) 시마다 인덱스도 함께 " +
      "갱신해야 하므로 쓰기 성능은 저하되고 저장 공간도 추가로 사용됩니다. 따라서 조회 패턴을 " +
      "분석해 꼭 필요한 컬럼에만 선별적으로 적용하는 것이 중요합니다.",
  },
};

function findTopic(question: string): { topic: string; answer: string } {
  const normalized = question.toLowerCase();
  for (const [id, topic] of Object.entries(KNOWLEDGE_BASE)) {
    if (topic.keywords.some((keyword) => normalized.includes(keyword.toLowerCase()))) {
      return { topic: id, answer: topic.answer };
    }
  }
  return {
    topic: "unknown",
    answer: `"${question}"에 대한 정보를 찾을 수 없습니다. 질문을 더 구체적으로 작성해 주세요.`,
  };
}

export interface BenchmarkDownstreamServer {
  url: string;
  callCount: () => number;
  close: () => Promise<void>;
}

export function startBenchmarkDownstreamServer(port: number): Promise<BenchmarkDownstreamServer> {
  let callCount = 0;

  function getServer() {
    const server = new McpServer({ name: "benchmark-knowledge-base", version: "0.1.0" });
    server.registerTool(
      "knowledge_lookup",
      {
        description: "질문에 대한 답변을 지식베이스에서 조회합니다",
        inputSchema: { question: z.string() },
      },
      async ({ question }) => {
        callCount += 1;
        const { topic, answer } = findTopic(question);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ answer, topic, sources: [`kb://${topic}`], confidence: 0.93 }),
            },
          ],
        };
      },
    );
    return server;
  }

  const app = createMcpExpressApp({
    allowedHosts: ["localhost", "127.0.0.1", "host.docker.internal"],
  });

  app.post("/mcp", async (req: any, res: any) => {
    const server = getServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("close", () => {
      transport.close();
      server.close();
    });
  });

  return new Promise((resolve) => {
    const httpServer = app.listen(port, () => {
      resolve({
        url: `http://localhost:${port}/mcp`,
        callCount: () => callCount,
        close: () => new Promise<void>((res) => httpServer.close(() => res())),
      });
    });
  });
}
