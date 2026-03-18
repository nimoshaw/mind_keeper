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

test("embedBatch reuses persistent cache for repeated remote embeddings", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-embedding-cache-"));
  const requests: string[][] = [];
  const server = createFakeEmbeddingServer(requests);
  const apiKeyEnv = "MIND_KEEPER_TEST_CACHE_API_KEY";
  process.env[apiKeyEnv] = "test-cache-key";

  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  const profile: EmbeddingProfile = {
    name: "remote-cache-test",
    kind: "openai_compatible",
    dimensions: 8,
    model: "fake-embedding",
    baseUrl,
    apiKeyEnv
  };
  const texts = ["alpha beta", "gamma delta", "alpha beta"];

  try {
    const firstService = new EmbeddingService();
    embeddingMetricsCollector.setEnabled(true);
    embeddingMetricsCollector.reset();

    const first = await firstService.embedBatch(profile, texts, { projectRoot });
    const firstSnapshot = embeddingMetricsCollector.snapshot();

    embeddingMetricsCollector.reset();
    const secondService = new EmbeddingService();
    const second = await secondService.embedBatch(profile, texts, { projectRoot });
    const secondSnapshot = embeddingMetricsCollector.snapshot();

    assert.deepEqual(first, second);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0], ["alpha beta", "gamma delta"]);
    assert.equal(firstSnapshot.providerCallCount, 1);
    assert.equal(firstSnapshot.cacheHits, 0);
    assert.equal(firstSnapshot.cacheMisses, 3);
    assert.equal(secondSnapshot.providerCallCount, 0);
    assert.equal(secondSnapshot.cacheHits, 3);
    assert.equal(secondSnapshot.cacheMisses, 0);
  } finally {
    embeddingMetricsCollector.reset();
    embeddingMetricsCollector.setEnabled(false);
    delete process.env[apiKeyEnv];
    await fs.rm(projectRoot, { recursive: true, force: true });
    server.closeAllConnections();
    server.close();
  }
});

test("embedding cache stays isolated across profiles", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-embedding-cache-profile-"));
  const requests: string[][] = [];
  const server = createFakeEmbeddingServer(requests);
  const apiKeyEnv = "MIND_KEEPER_TEST_CACHE_PROFILE_API_KEY";
  process.env[apiKeyEnv] = "test-cache-profile-key";

  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  const profileA: EmbeddingProfile = {
    name: "remote-cache-a",
    kind: "openai_compatible",
    dimensions: 8,
    model: "fake-embedding",
    baseUrl,
    apiKeyEnv
  };
  const profileB: EmbeddingProfile = {
    ...profileA,
    name: "remote-cache-b"
  };

  try {
    const service = new EmbeddingService();
    const texts = ["shared text across profiles"];

    await service.embedBatch(profileA, texts, { projectRoot });
    await service.embedBatch(profileB, texts, { projectRoot });

    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0], texts);
    assert.deepEqual(requests[1], texts);
  } finally {
    delete process.env[apiKeyEnv];
    await fs.rm(projectRoot, { recursive: true, force: true });
    server.closeAllConnections();
    server.close();
  }
});

function createFakeEmbeddingServer(requests: string[][]): http.Server {
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
