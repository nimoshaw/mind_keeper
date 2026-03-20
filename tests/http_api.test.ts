import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHttpServer } from "../src/http-server.js";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

function request(
  port: number,
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<{ status: number; data: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {})
        }
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          try {
            resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode ?? 0, data: { _raw: raw } });
          }
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe("HTTP API", () => {
  let port: number;
  let projectRoot: string;
  let stop: () => Promise<void>;

  before(async () => {
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "mk-http-test-"));
    await mkdir(path.join(projectRoot, ".mindkeeper"), { recursive: true });
    port = 16700 + Math.floor(Math.random() * 1000);
    const srv = createHttpServer({ port, projectRoot });
    stop = srv.stop;
    await srv.start();
  });

  after(async () => {
    await stop();
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("GET /api/health returns ok", async () => {
    const res = await request(port, "GET", "/api/health");
    assert.equal(res.status, 200);
    assert.equal(res.data.status, "ok");
    assert.equal(res.data.service, "mind-keeper");
    assert.ok(res.data.timestamp);
  });

  it("OPTIONS returns 204 for CORS preflight", async () => {
    const res = await request(port, "OPTIONS", "/api/health");
    assert.equal(res.status, 204);
  });

  it("GET /api/unknown returns 404", async () => {
    const res = await request(port, "GET", "/api/unknown");
    assert.equal(res.status, 404);
    assert.equal(res.data.error, "not_found");
  });

  it("POST /api/bootstrap creates project scaffold", async () => {
    const res = await request(port, "POST", "/api/bootstrap", {
      project_root: projectRoot
    });
    assert.equal(res.status, 200);
    assert.ok(res.data.projectName);
  });

  it("GET /api/sources lists sources with default project root", async () => {
    const res = await request(port, "GET", "/api/sources");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.data) || typeof res.data === "object");
  });

  it("POST /api/domains creates a domain", async () => {
    const res = await request(port, "POST", "/api/domains", {
      name: "test-domain",
      display_name: "Test Domain",
      aliases: ["test", "测试"],
      description: "A test domain"
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.name, "test-domain");
    assert.equal(res.data.displayName, "Test Domain");
  });

  it("GET /api/domains lists domains", async () => {
    const res = await request(port, "GET", "/api/domains");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.data));
    const domains = res.data as Array<Record<string, unknown>>;
    assert.ok(domains.length >= 1);
    assert.equal(domains[0].name, "test-domain");
  });

  it("POST /api/domains/resolve finds domain by alias", async () => {
    const res = await request(port, "POST", "/api/domains/resolve", {
      query: "测试"
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.name, "test-domain");
  });

  it("DELETE /api/domains/:name deletes a domain", async () => {
    const res = await request(port, "DELETE", "/api/domains/test-domain");
    assert.equal(res.status, 200);
  });

  it("GET /api/flash returns flash state", async () => {
    const res = await request(port, "GET", "/api/flash");
    assert.equal(res.status, 200);
  });
});
