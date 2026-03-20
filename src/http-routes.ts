import type http from "node:http";
import type { MindKeeperService } from "./mindkeeper-facade.js";
import type { MemorySourceKind } from "./types.js";

export interface RouteContext {
  service: MindKeeperService;
  defaultProjectRoot: string | null;
}

type RouteHandler = (body: Record<string, unknown>, ctx: RouteContext) => Promise<unknown>;

const routes = new Map<string, RouteHandler>();

function route(method: string, path: string, handler: RouteHandler): void {
  routes.set(`${method} ${path}`, handler);
}

// ── Health ──────────────────────────────────────────────────────

route("GET", "/api/health", async () => ({
  status: "ok",
  service: "mind-keeper",
  timestamp: new Date().toISOString()
}));

// ── Bootstrap & Inspect ────────────────────────────────────────

route("POST", "/api/bootstrap", async (body, ctx) => {
  const { ensureProjectScaffold } = await import("./project.js");
  return ensureProjectScaffold(requireProjectRoot(body, ctx));
});

route("GET", "/api/memory/access-surface", async (body, ctx) => {
  return ctx.service.inspectMemoryAccessSurface(requireProjectRoot(body, ctx));
});

route("GET", "/api/memory/canonical", async (body, ctx) => {
  return ctx.service.inspectCanonicalMemory(requireProjectRoot(body, ctx), {
    recentLimit: optionalInt(body.recent_limit)
  });
});

route("GET", "/api/memory/governance", async (body, ctx) => {
  return ctx.service.inspectCanonicalGovernance(requireProjectRoot(body, ctx), {
    olderThanDays: optionalInt(body.older_than_days),
    topK: optionalInt(body.top_k)
  });
});

// ── Remember ───────────────────────────────────────────────────

route("POST", "/api/remember", async (body, ctx) => {
  return ctx.service.remember({
    projectRoot: requireProjectRoot(body, ctx),
    content: requireString(body.content, "content"),
    sourceKind: requireString(body.source_kind, "source_kind") as Exclude<MemorySourceKind, "project">,
    title: optionalString(body.title),
    moduleName: optionalString(body.module_name),
    tags: optionalStringArray(body.tags)
  });
});

route("POST", "/api/remember-decision", async (body, ctx) => {
  return ctx.service.rememberDecision({
    projectRoot: requireProjectRoot(body, ctx),
    title: requireString(body.title, "title"),
    decision: requireString(body.decision, "decision"),
    rationale: optionalString(body.rationale),
    impact: optionalString(body.impact),
    moduleName: optionalString(body.module_name),
    tags: optionalStringArray(body.tags)
  });
});

route("POST", "/api/remember-log", async (body, ctx) => {
  return ctx.service.rememberLog({
    projectRoot: requireProjectRoot(body, ctx),
    event: requireString(body.event, "event"),
    model: optionalString(body.model),
    action: optionalString(body.action),
    testResult: optionalString(body.test_result),
    notes: optionalString(body.notes),
    tags: optionalStringArray(body.tags)
  });
});

// ── Recall ─────────────────────────────────────────────────────


route("POST", "/api/recall", async (body, ctx) => {
  return ctx.service.recall({
    projectRoot: requireProjectRoot(body, ctx),
    query: requireString(body.query, "query"),
    topK: optionalInt(body.top_k),
    sourceKinds: optionalStringArray(body.source_kinds) as MemorySourceKind[] | undefined,
    pathContains: optionalString(body.path_contains),
    moduleName: optionalString(body.module_name),
    explain: optionalBool(body.explain)
  });
});

route("POST", "/api/recall/fast", async (body, ctx) => {
  return ctx.service.recallFast({
    projectRoot: requireProjectRoot(body, ctx),
    query: requireString(body.query, "query"),
    topK: optionalInt(body.top_k),
    explain: optionalBool(body.explain)
  });
});

route("POST", "/api/recall/deep", async (body, ctx) => {
  return ctx.service.recallDeep({
    projectRoot: requireProjectRoot(body, ctx),
    query: requireString(body.query, "query"),
    topK: optionalInt(body.top_k),
    explain: optionalBool(body.explain)
  });
});

route("POST", "/api/context-for-task", async (body, ctx) => {
  return ctx.service.contextForTask({
    projectRoot: requireProjectRoot(body, ctx),
    task: requireString(body.task, "task"),
    currentFile: optionalString(body.current_file),
    currentSymbol: optionalString(body.current_symbol),
    selectedText: optionalString(body.selected_text),
    diagnostics: optionalString(body.diagnostics),
    branchName: optionalString(body.branch_name),
    relatedFiles: optionalStringArray(body.related_files),
    topK: optionalInt(body.top_k)
  });
});

// ── Sources ────────────────────────────────────────────────────

route("GET", "/api/sources", async (body, ctx) => {
  return ctx.service.listSources(requireProjectRoot(body, ctx));
});

route("POST", "/api/sources/forget", async (body, ctx) => {
  return ctx.service.forget({
    projectRoot: requireProjectRoot(body, ctx),
    docId: optionalString(body.doc_id),
    path: optionalString(body.path)
  });
});

route("POST", "/api/sources/disable", async (body, ctx) => {
  return ctx.service.disableSource({
    projectRoot: requireProjectRoot(body, ctx),
    docId: optionalString(body.doc_id),
    path: optionalString(body.path),
    reason: optionalString(body.reason)
  });
});

route("POST", "/api/sources/enable", async (body, ctx) => {
  return ctx.service.enableSource({
    projectRoot: requireProjectRoot(body, ctx),
    docId: optionalString(body.doc_id),
    path: optionalString(body.path)
  });
});

route("POST", "/api/sources/rate", async (body, ctx) => {
  return ctx.service.rateSource({
    projectRoot: requireProjectRoot(body, ctx),
    signal: requireString(body.signal, "signal") as "helpful" | "noisy",
    docId: optionalString(body.doc_id),
    path: optionalString(body.path),
    reason: optionalString(body.reason)
  });
});

// ── Flash ──────────────────────────────────────────────────────

route("GET", "/api/flash", async (body, ctx) => {
  return ctx.service.flashResume(requireProjectRoot(body, ctx));
});

route("POST", "/api/flash", async (body, ctx) => {
  return ctx.service.flashCheckpoint({
    projectRoot: requireProjectRoot(body, ctx),
    title: requireString(body.title, "title"),
    sessionGoal: requireString(body.session_goal, "session_goal"),
    currentStatus: requireString(body.current_status, "current_status"),
    workingMemory: optionalString(body.working_memory),
    nextSteps: optionalStringArray(body.next_steps),
    blockers: optionalStringArray(body.blockers),
    openQuestions: optionalStringArray(body.open_questions),
    branchName: optionalString(body.branch_name),
    touchedFiles: optionalStringArray(body.touched_files),
    importantCommands: optionalStringArray(body.important_commands),
    tags: optionalStringArray(body.tags)
  });
});

route("DELETE", "/api/flash", async (body, ctx) => {
  return ctx.service.flashClear(requireProjectRoot(body, ctx));
});

// ── Session ────────────────────────────────────────────────────

route("POST", "/api/session/suggest", async (body, ctx) => {
  return ctx.service.suggestSessionMemory({
    projectRoot: requireProjectRoot(body, ctx),
    sessionText: requireString(body.session_text, "session_text"),
    title: optionalString(body.title),
    moduleName: optionalString(body.module_name)
  });
});

route("POST", "/api/session/summarize", async (body, ctx) => {
  return ctx.service.summarizeSession({
    projectRoot: requireProjectRoot(body, ctx),
    title: requireString(body.title, "title"),
    sessionText: requireString(body.session_text, "session_text"),
    kind: optionalString(body.kind) as "diary" | "decision" | "knowledge" | undefined,
    moduleName: optionalString(body.module_name),
    tags: optionalStringArray(body.tags)
  });
});

// ── Domains ────────────────────────────────────────────────────

route("GET", "/api/domains", async (body, ctx) => {
  return ctx.service.domainList(requireProjectRoot(body, ctx));
});

route("POST", "/api/domains", async (body, ctx) => {
  return ctx.service.domainCreate(requireProjectRoot(body, ctx), {
    name: requireString(body.name, "name"),
    displayName: requireString(body.display_name, "display_name"),
    aliases: optionalStringArray(body.aliases),
    description: optionalString(body.description),
    tags: optionalStringArray(body.tags),
    sections: body.sections as Array<{ dir: string; label: string }> | undefined
  });
});

route("POST", "/api/domains/resolve", async (body, ctx) => {
  return ctx.service.domainResolve(
    requireProjectRoot(body, ctx),
    requireString(body.query, "query")
  );
});

route("PUT", "/api/domains/:name", async (body, ctx) => {
  return ctx.service.domainUpdate(
    requireProjectRoot(body, ctx),
    requireString(body._routeParam, "_routeParam"),
    {
      displayName: optionalString(body.display_name),
      aliases: optionalStringArray(body.aliases),
      description: optionalString(body.description),
      tags: optionalStringArray(body.tags)
    }
  );
});

route("DELETE", "/api/domains/:name", async (body, ctx) => {
  return ctx.service.domainDelete(
    requireProjectRoot(body, ctx),
    requireString(body._routeParam, "_routeParam")
  );
});

route("POST", "/api/domains/:name/sections", async (body, ctx) => {
  return ctx.service.domainAddSection(
    requireProjectRoot(body, ctx),
    requireString(body._routeParam, "_routeParam"),
    {
      dir: requireString(body.section_dir, "section_dir"),
      label: requireString(body.section_label, "section_label")
    }
  );
});

// ── Hygiene ────────────────────────────────────────────────────

route("GET", "/api/hygiene/health", async (body, ctx) => {
  return ctx.service.reviewMemoryHealth({
    projectRoot: requireProjectRoot(body, ctx),
    olderThanDays: optionalInt(body.older_than_days),
    topK: optionalInt(body.top_k)
  });
});

route("POST", "/api/hygiene/cleanup/suggest", async (body, ctx) => {
  return ctx.service.suggestMemoryCleanup({
    projectRoot: requireProjectRoot(body, ctx),
    olderThanDays: optionalInt(body.older_than_days),
    topK: optionalInt(body.top_k)
  });
});

route("POST", "/api/hygiene/consolidate/suggest", async (body, ctx) => {
  return ctx.service.suggestConsolidations({
    projectRoot: requireProjectRoot(body, ctx),
    topK: optionalInt(body.top_k)
  });
});

route("POST", "/api/hygiene/consolidate", async (body, ctx) => {
  return ctx.service.consolidateMemories({
    projectRoot: requireProjectRoot(body, ctx),
    docIds: requireStringArray(body.doc_ids, "doc_ids"),
    title: requireString(body.title, "title"),
    kind: optionalString(body.kind) as "knowledge" | "decision" | undefined,
    moduleName: optionalString(body.module_name),
    tags: optionalStringArray(body.tags),
    disableInputs: optionalBool(body.disable_inputs)
  });
});

route("GET", "/api/hygiene/conflicts", async (body, ctx) => {
  return ctx.service.listConflicts({
    projectRoot: requireProjectRoot(body, ctx),
    topK: optionalInt(body.top_k)
  });
});

// ── Index ──────────────────────────────────────────────────────

route("POST", "/api/index-project", async (body, ctx) => {
  return ctx.service.indexProject(requireProjectRoot(body, ctx), {
    force: optionalBool(body.force)
  });
});

route("POST", "/api/profile/rebuild", async (body, ctx) => {
  return ctx.service.rebuildActiveProfileIndex(requireProjectRoot(body, ctx));
});

route("POST", "/api/profile/recover", async (body, ctx) => {
  return ctx.service.recoverProfileIndex({
    projectRoot: requireProjectRoot(body, ctx),
    strategy: optionalString(body.strategy) as "safe" | "standard" | "aggressive" | undefined,
    dryRun: optionalBool(body.dry_run)
  });
});

// ── Request Handler ────────────────────────────────────────────

export async function handleApiRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: RouteContext
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const method = (req.method ?? "GET").toUpperCase();
  const pathname = url.pathname.replace(/\/+$/, "") || "/";

  // Parse body for POST/PUT/DELETE, query params for GET
  let body: Record<string, unknown> = {};
  if (method === "GET") {
    for (const [key, value] of url.searchParams) {
      body[key] = value;
    }
  } else {
    body = await readJsonBody(req);
  }

  // Resolve project_root from body, header, or default
  if (!body.project_root) {
    const headerRoot = req.headers["x-project-root"];
    if (typeof headerRoot === "string" && headerRoot.trim()) {
      body.project_root = headerRoot.trim();
    } else if (ctx.defaultProjectRoot) {
      body.project_root = ctx.defaultProjectRoot;
    }
  }

  // Try exact match first
  let handler = routes.get(`${method} ${pathname}`);

  // Try parameterized route matching (e.g. /api/domains/:name)
  if (!handler) {
    for (const [key, h] of routes) {
      const [routeMethod, routePath] = key.split(" ", 2);
      if (routeMethod !== method) continue;
      const paramMatch = matchParamRoute(routePath, pathname);
      if (paramMatch) {
        handler = h;
        body._routeParam = paramMatch;
        break;
      }
    }
  }

  if (!handler) {
    res.writeHead(404);
    res.end(JSON.stringify({ error: "not_found", path: pathname }));
    return;
  }

  const result = await handler(body, ctx);
  res.writeHead(200);
  res.end(JSON.stringify(result, null, 2));
}

// ── Helpers ────────────────────────────────────────────────────

function matchParamRoute(pattern: string, actual: string): string | null {
  const patternParts = pattern.split("/");
  const actualParts = actual.split("/");
  if (patternParts.length !== actualParts.length) return null;

  let paramValue: string | null = null;
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(":")) {
      paramValue = decodeURIComponent(actualParts[i]);
    } else if (patternParts[i] !== actualParts[i]) {
      return null;
    }
  }
  return paramValue;
}

function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        resolve(typeof parsed === "object" && parsed !== null ? parsed : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function requireProjectRoot(body: Record<string, unknown>, ctx: RouteContext): string {
  const value = body.project_root ?? ctx.defaultProjectRoot;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("project_root is required (body, X-Project-Root header, or MIND_KEEPER_PROJECT_ROOT env)");
  }
  return value;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is required and must be a non-empty string`);
  }
  return value;
}

function requireStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${name} is required and must be a non-empty array`);
  }
  return value.filter((item): item is string => typeof item === "string");
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function optionalInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function optionalBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}
