import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DownstreamMcpError, callDownstreamTool } from "../../src/proxy/index.js";
import { startTestDownstreamServer, type TestDownstreamServer } from "../helpers/downstream-server.js";

describe("proxy: callDownstreamTool", () => {
  let downstream: TestDownstreamServer;

  beforeAll(async () => {
    downstream = await startTestDownstreamServer(4400);
  });

  afterAll(async () => {
    await downstream.close();
  });

  it("calls the downstream tool and relays its result", async () => {
    const result = await callDownstreamTool(downstream.url, "echo", { key: "a" });
    expect(result.content[0]).toMatchObject({ type: "text" });
  });

  it("reuses the connection on a second call to the same endpoint", async () => {
    const before = downstream.callCount();
    await callDownstreamTool(downstream.url, "echo", { key: "b" });
    expect(downstream.callCount()).toBe(before + 1);
  });

  it("throws DownstreamMcpError for an unreachable endpoint", async () => {
    await expect(
      callDownstreamTool("http://localhost:9999/mcp", "echo", { key: "x" }),
    ).rejects.toBeInstanceOf(DownstreamMcpError);
  });
});
