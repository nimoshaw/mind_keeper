import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { VectorizationScheduler } from "../src/app/vectorization-scheduler.js";
import { EmbeddingBatchBroker } from "../src/app/embedding-batch-broker.js";
import type { EmbeddingProfile } from "../src/types.js";

test("scheduler aggregates items arriving within the debounce window", async () => {
  const requests: string[][] = [];
  const server = createFakeServer(requests);
  const apiKeyEnv = "MIND_KEEPER_TEST_SCHED_WIN_KEY";
  process.env[apiKeyEnv] = "test-key";

  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  const profile: EmbeddingProfile = {
    name: "sched-window-test",
    kind: "openai_compatible",
    dimensions: 8,
    model: "fake-embedding",
    baseUrl,
    apiKeyEnv
  };

  const broker = new EmbeddingBatchBroker();
  const scheduler = new VectorizationScheduler({
    broker,
    windowMs: 80,
    maxWindowMs: 500,
    flushItemThreshold: 100,
    flushTokenThreshold: 100_000
  });

  try {
    const first = scheduler.schedule(profile, ["alpha one"]);
    const second = scheduler.schedule(profile, ["beta two"]);

    const [result1, result2] = await Promise.all([first, second]);
    assert.equal(result1.length, 1);
    assert.equal(result2.length, 1);
    assert.equal(requests.length, 1, "items within window should merge into a single provider call");
    assert.deepEqual(requests[0].sort(), ["alpha one", "beta two"]);
  } finally {
    delete process.env[apiKeyEnv];
    server.closeAllConnections();
    server.close();
  }
});

test("scheduler flushes immediately when item threshold is reached", async () => {
  const requests: string[][] = [];
  const server = createFakeServer(requests);
  const apiKeyEnv = "MIND_KEEPER_TEST_SCHED_THRESH_KEY";
  process.env[apiKeyEnv] = "test-key";

  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  const profile: EmbeddingProfile = {
    name: "sched-threshold-test",
    kind: "openai_compatible",
    dimensions: 8,
    model: "fake-embedding",
    baseUrl,
    apiKeyEnv
  };

  const broker = new EmbeddingBatchBroker();
  const scheduler = new VectorizationScheduler({
    broker,
    windowMs: 5000,
    maxWindowMs: 10000,
    flushItemThreshold: 3,
    flushTokenThreshold: 100_000
  });

  try {
    const result = await scheduler.schedule(profile, ["item-a", "item-b", "item-c"]);
    assert.equal(result.length, 3);
    assert.ok(requests.length >= 1, "threshold should trigger immediate flush without waiting for window");
  } finally {
    delete process.env[apiKeyEnv];
    server.closeAllConnections();
    server.close();
  }
});

test("scheduler deduplicates identical texts within the same window", async () => {
  const requests: string[][] = [];
  const server = createFakeServer(requests);
  const apiKeyEnv = "MIND_KEEPER_TEST_SCHED_DEDUP_KEY";
  process.env[apiKeyEnv] = "test-key";

  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  const profile: EmbeddingProfile = {
    name: "sched-dedup-test",
    kind: "openai_compatible",
    dimensions: 8,
    model: "fake-embedding",
    baseUrl,
    apiKeyEnv
  };

  const broker = new EmbeddingBatchBroker();
  const scheduler = new VectorizationScheduler({
    broker,
    windowMs: 80,
    maxWindowMs: 500,
    flushItemThreshold: 100,
    flushTokenThreshold: 100_000
  });

  try {
    const result = await scheduler.schedule(profile, ["same text", "same text", "different text"]);
    assert.equal(result.length, 3);
    assert.deepEqual(result[0], result[1], "duplicate texts should get the same vector");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].length, 2, "only unique texts should be sent to the provider");
  } finally {
    delete process.env[apiKeyEnv];
    server.closeAllConnections();
    server.close();
  }
});

test("scheduler shutdown flushes all pending items", async () => {
  const requests: string[][] = [];
  const server = createFakeServer(requests);
  const apiKeyEnv = "MIND_KEEPER_TEST_SCHED_SHUT_KEY";
  process.env[apiKeyEnv] = "test-key";

  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  const profile: EmbeddingProfile = {
    name: "sched-shutdown-test",
    kind: "openai_compatible",
    dimensions: 8,
    model: "fake-embedding",
    baseUrl,
    apiKeyEnv
  };

  const broker = new EmbeddingBatchBroker();
  const scheduler = new VectorizationScheduler({
    broker,
    windowMs: 30000,
    maxWindowMs: 60000,
    flushItemThreshold: 100,
    flushTokenThreshold: 100_000
  });

  try {
    const pending = scheduler.schedule(profile, ["pending item"]);
    await scheduler.shutdown();
    const result = await pending;
    assert.equal(result.length, 1);
    assert.ok(requests.length >= 1, "shutdown should flush pending items");
  } finally {
    delete process.env[apiKeyEnv];
    server.closeAllConnections();
    server.close();
  }
});

function createFakeServer(requests: string[][]): http.Server {
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
