import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { embeddingMetricsCollector } from "../src/embedding-metrics.js";
import { EmbeddingService } from "../src/embedding.js";
import type { EmbeddingProfile } from "../src/types.js";

test("embedding broker merges concurrent remote requests for the same profile", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-embedding-broker-"));
  const requests: string[][] = [];
  const server = createDelayedEmbeddingServer(requests, 40);
  const apiKeyEnv = "MIND_KEEPER_TEST_BROKER_API_KEY";
  process.env[apiKeyEnv] = "test-broker-key";
  process.env.MIND_KEEPER_EMBED_BROKER_WINDOW_MS = "25";

  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  const profile: EmbeddingProfile = {
    name: "remote-broker-test",
    kind: "openai_compatible",
    dimensions: 8,
    model: "fake-embedding",
    baseUrl,
    apiKeyEnv
  };

  try {
    const leftService = new EmbeddingService();
    const rightService = new EmbeddingService();
    embeddingMetricsCollector.setEnabled(true);
    embeddingMetricsCollector.reset();

    const [left, right] = await Promise.all([
      leftService.embedBatch(profile, ["alpha one", "shared two"], { projectRoot }),
      rightService.embedBatch(profile, ["beta three", "shared two"], { projectRoot })
    ]);
    const snapshot = embeddingMetricsCollector.snapshot();

    assert.equal(left.length, 2);
    assert.equal(right.length, 2);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0], ["alpha one", "shared two", "beta three"]);
    assert.equal(snapshot.logicalRequestCount, 2);
    assert.equal(snapshot.providerCallCount, 1);
  } finally {
    embeddingMetricsCollector.reset();
    embeddingMetricsCollector.setEnabled(false);
    delete process.env[apiKeyEnv];
    delete process.env.MIND_KEEPER_EMBED_BROKER_WINDOW_MS;
    await fs.rm(projectRoot, { recursive: true, force: true });
    server.closeAllConnections();
    server.close();
  }
});

test("embedding broker keeps different profiles in separate remote requests", async () => {
  const requests: string[][] = [];
  const server = createDelayedEmbeddingServer(requests, 20);
  const apiKeyEnv = "MIND_KEEPER_TEST_BROKER_PROFILE_API_KEY";
  process.env[apiKeyEnv] = "test-broker-profile-key";
  process.env.MIND_KEEPER_EMBED_BROKER_WINDOW_MS = "25";

  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  const profileA: EmbeddingProfile = {
    name: "remote-broker-a",
    kind: "openai_compatible",
    dimensions: 8,
    model: "fake-embedding",
    baseUrl,
    apiKeyEnv
  };
  const profileB: EmbeddingProfile = {
    ...profileA,
    name: "remote-broker-b"
  };

  try {
    const service = new EmbeddingService();

    await Promise.all([
      service.embedBatch(profileA, ["alpha request"]),
      service.embedBatch(profileB, ["beta request"])
    ]);

    assert.equal(requests.length, 2);
    assert.deepEqual(requests.map((item) => item[0]).sort(), ["alpha request", "beta request"]);
  } finally {
    delete process.env[apiKeyEnv];
    delete process.env.MIND_KEEPER_EMBED_BROKER_WINDOW_MS;
    server.closeAllConnections();
    server.close();
  }
});

function createDelayedEmbeddingServer(requests: string[][], delayMs: number): http.Server {
  const server = http.createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/embeddings") {
      response.writeHead(404);
      response.end();
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      input: string[] | string;
      model: string;
    };
    const inputs = Array.isArray(payload.input) ? payload.input : [payload.input];
    requests.push(inputs);

    await new Promise((resolve) => setTimeout(resolve, delayMs));

    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        object: "list",
        data: inputs.map((input, index) => ({
          object: "embedding",
          index,
          embedding: fakeEmbedding(input)
        })),
        model: payload.model,
        usage: {
          prompt_tokens: 0,
          total_tokens: 0
        }
      })
    );
  });

  server.listen(0, "127.0.0.1");
  return server;
}

function fakeEmbedding(input: string): number[] {
  const seed = [...input].reduce((sum, char, index) => sum + char.charCodeAt(0) * (index + 1), 0);
  return new Array(8).fill(0).map((_, index) => Number((((seed + index * 17) % 97) / 97).toFixed(6)));
}
