import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MindKeeperService } from "./mindkeeper-facade.js";
import { handleApiRequest } from "./http-routes.js";

const DEFAULT_PORT = 6700;
const DEFAULT_HOST = "127.0.0.1";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

export interface HttpServerOptions {
  port?: number;
  host?: string;
  projectRoot?: string;
}

function resolveDashboardDir(): string {
  // In dev (tsx): src/http-server.ts → src/dashboard/
  // In prod (node): dist/http-server.js → dist/dashboard/
  const candidate = path.join(__dirname, "dashboard");
  if (fs.existsSync(candidate)) return candidate;
  // Fallback: src/dashboard relative to project root
  const srcCandidate = path.join(__dirname, "..", "src", "dashboard");
  if (fs.existsSync(srcCandidate)) return srcCandidate;
  return candidate;
}

function serveStaticFile(res: http.ServerResponse, filePath: string): boolean {
  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] ?? "application/octet-stream";
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { "Content-Type": mime });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

export function createHttpServer(options?: HttpServerOptions) {
  const port = options?.port ?? envPositiveInt("MIND_KEEPER_HTTP_PORT", DEFAULT_PORT);
  const host = options?.host ?? process.env.MIND_KEEPER_HTTP_HOST ?? DEFAULT_HOST;
  const defaultProjectRoot = options?.projectRoot ?? process.env.MIND_KEEPER_PROJECT_ROOT ?? null;
  const service = new MindKeeperService();
  const dashboardDir = resolveDashboardDir();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Project-Root");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // API routes
    if (url.pathname.startsWith("/api/")) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      try {
        await handleApiRequest(req, res, { service, defaultProjectRoot });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!res.headersSent) {
          res.writeHead(500);
        }
        res.end(JSON.stringify({ error: "internal_server_error", message }));
      }
      return;
    }

    // Static dashboard files
    const safePath = path.normalize(url.pathname).replace(/^(\.\.[\\/])+/, "");
    const requestedFile = safePath === "/" || safePath === "\\"
      ? path.join(dashboardDir, "index.html")
      : path.join(dashboardDir, safePath);

    // Security: prevent path traversal
    if (!requestedFile.startsWith(dashboardDir)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    if (serveStaticFile(res, requestedFile)) return;

    // SPA fallback: serve index.html for non-file routes
    if (serveStaticFile(res, path.join(dashboardDir, "index.html"))) return;

    res.writeHead(404);
    res.end("Not Found");
  });

  return {
    server,
    start: () =>
      new Promise<void>((resolve) => {
        server.listen(port, host, () => {
          console.log(`[mind-keeper] Dashboard: http://${host}:${port}`);
          console.log(`[mind-keeper] API:       http://${host}:${port}/api/health`);
          resolve();
        });
      }),
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
    port,
    host
  };
}

export async function startHttpServer(options?: HttpServerOptions): Promise<void> {
  const { start } = createHttpServer(options);
  await start();
}

function envPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

