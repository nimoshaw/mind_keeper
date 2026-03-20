/**
 * MCP Remote Proxy — 让其他电脑通过 stdio 接入远程 Mind Keeper HTTP API
 *
 * 原理: AntiGravity 以为这是本地 MCP server (stdio)，实际上所有请求
 *       都被转发到远程 HTTP API。
 *
 * 配置 (~/.gemini/settings.json):
 * {
 *   "mcpServers": {
 *     "mind-keeper": {
 *       "command": "node",
 *       "args": ["path/to/dist/mcp-proxy.js", "--server", "http://192.168.x.x:6700"]
 *     }
 *   }
 * }
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

const serverArg = process.argv.indexOf("--server");
const REMOTE_URL = serverArg !== -1 && process.argv[serverArg + 1]
  ? process.argv[serverArg + 1]
  : process.env.MIND_KEEPER_SERVER ?? "http://127.0.0.1:6700";

async function remoteApi(method: string, path: string, body?: Record<string, unknown>): Promise<unknown> {
  const opts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" }
  };
  if (body) opts.body = JSON.stringify(body);

  let url = `${REMOTE_URL}${path}`;
  if (method === "GET" && body) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined && v !== null) params.set(k, String(v));
    }
    url += `?${params.toString()}`;
  }

  const res = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) {
    throw new Error((data as Record<string, string>).message ?? `HTTP ${res.status}`);
  }
  return data;
}

// Map MCP tool names to HTTP API routes
const TOOL_ROUTES: Record<string, { method: string; path: string }> = {
  remember: { method: "POST", path: "/api/remember" },
  remember_decision: { method: "POST", path: "/api/remember-decision" },
  recall: { method: "POST", path: "/api/recall" },
  recall_fast: { method: "POST", path: "/api/recall/fast" },
  recall_deep: { method: "POST", path: "/api/recall/deep" },
  context_for_task: { method: "POST", path: "/api/context-for-task" },
  list_sources: { method: "GET", path: "/api/sources" },
  forget: { method: "POST", path: "/api/sources/forget" },
  disable_source: { method: "POST", path: "/api/sources/disable" },
  enable_source: { method: "POST", path: "/api/sources/enable" },
  rate_source: { method: "POST", path: "/api/sources/rate" },
  flash_checkpoint: { method: "POST", path: "/api/flash" },
  flash_resume: { method: "GET", path: "/api/flash" },
  flash_clear: { method: "DELETE", path: "/api/flash" },
  suggest_session_memory: { method: "POST", path: "/api/session/suggest" },
  summarize_session: { method: "POST", path: "/api/session/summarize" },
  domain_create: { method: "POST", path: "/api/domains" },
  domain_list: { method: "GET", path: "/api/domains" },
  domain_resolve: { method: "POST", path: "/api/domains/resolve" },
  domain_update: { method: "PUT", path: "/api/domains" },
  domain_delete: { method: "DELETE", path: "/api/domains" },
  domain_add_section: { method: "POST", path: "/api/domains" },
  index_project: { method: "POST", path: "/api/index-project" },
  inspect_memory: { method: "GET", path: "/api/memory/access-surface" },
  inspect_canonical: { method: "GET", path: "/api/memory/canonical" },
  review_memory_health: { method: "GET", path: "/api/hygiene/health" },
  suggest_cleanup: { method: "POST", path: "/api/hygiene/cleanup/suggest" },
  suggest_consolidations: { method: "POST", path: "/api/hygiene/consolidate/suggest" },
  consolidate_memories: { method: "POST", path: "/api/hygiene/consolidate" },
  list_conflicts: { method: "GET", path: "/api/hygiene/conflicts" }
};

const server = new Server(
  { name: "mind-keeper-proxy", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: Object.keys(TOOL_ROUTES).map(name => ({
      name,
      description: `[Remote Proxy] ${name} → ${REMOTE_URL}`,
      inputSchema: {
        type: "object" as const,
        properties: {},
        additionalProperties: true
      }
    }))
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;
  const route = TOOL_ROUTES[toolName];

  if (!route) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
      isError: true
    };
  }

  try {
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    // Convert snake_case MCP params to API params
    const body = snakeToCamelBody(args);

    // Handle dynamic routes (domain_update, domain_delete, domain_add_section)
    let path = route.path;
    if (toolName === "domain_update" && body.name) {
      path = `/api/domains/${encodeURIComponent(String(body.name))}`;
    } else if (toolName === "domain_delete" && body.name) {
      path = `/api/domains/${encodeURIComponent(String(body.name))}`;
    } else if (toolName === "domain_add_section" && body.name) {
      path = `/api/domains/${encodeURIComponent(String(body.name))}/sections`;
    }

    const result = await remoteApi(route.method, path, body);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error: ${msg}` }],
      isError: true
    };
  }
});

function snakeToCamelBody(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = value;
    // Also keep original snake_case for API compatibility
    result[key] = value;
  }
  return result;
}

const transport = new StdioServerTransport();
server.connect(transport).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[mind-keeper-proxy] Failed to start: ${msg}\n`);
  process.exitCode = 1;
});
