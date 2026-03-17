import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { extractSymbolSpans, inferSymbolName } from "../src/symbols.js";

function hasCommand(file: string, args: string[] = ["--version"]): boolean {
  try {
    execFileSync(file, args, {
      stdio: "ignore",
      windowsHide: true
    });
    return true;
  } catch {
    return false;
  }
}

function hasJavaTools(): boolean {
  if (!hasCommand("javac", ["-version"])) {
    return false;
  }

  try {
    execFileSync("where.exe", ["javac"], {
      stdio: "ignore",
      windowsHide: true
    });
    return true;
  } catch {
    return false;
  }
}

test("extracts TypeScript symbols with parser-backed adapter", () => {
  const content = [
    "export class MemoryStore {",
    "  async remember(text: string) {",
    "    return text;",
    "  }",
    "}",
    "",
    "export function recallTask(query: string) {",
    "  return query;",
    "}"
  ].join("\n");

  const spans = extractSymbolSpans("memory.ts", content).map((item) => item.name);
  assert.deepEqual(spans.slice(0, 3), ["MemoryStore", "remember", "recallTask"]);
  assert.equal(inferSymbolName("memory.ts", content, false, "memory.ts", true), "MemoryStore");
});

test("extracts Python symbols when Python is available", { skip: !hasCommand("py", ["-3", "--version"]) && !hasCommand("python") && !hasCommand("python3") }, () => {
  const content = [
    "class MemoryStore:",
    "    def remember(self, text):",
    "        return text",
    "",
    "async def recall_task(query):",
    "    return query"
  ].join("\n");

  const spans = extractSymbolSpans("memory.py", content).map((item) => item.name);
  assert.deepEqual(spans, ["MemoryStore", "remember", "recall_task"]);
});

test("extracts Go symbols when Go is available", { skip: !hasCommand("go", ["version"]) }, () => {
  const content = [
    "package memory",
    "",
    "type Store struct{}",
    "",
    "func Remember(text string) string {",
    "    return text",
    "}",
    "",
    "func (s *Store) Recall(query string) string {",
    "    return query",
    "}"
  ].join("\n");

  const spans = extractSymbolSpans("memory.go", content).map((item) => item.name);
  assert.deepEqual(spans, ["Store", "Remember", "Recall"]);
});

test("extracts Rust symbols when Cargo is available", { skip: !hasCommand("cargo", ["--version"]) }, () => {
  const content = [
    "struct MemoryStore;",
    "",
    "trait Keeper {",
    "    fn remember(&self, text: &str) -> String;",
    "}",
    "",
    "impl MemoryStore {",
    "    fn recall(&self, query: &str) -> String {",
    "        query.to_string()",
    "    }",
    "}"
  ].join("\n");

  const spans = extractSymbolSpans("memory.rs", content).map((item) => item.name);
  assert.deepEqual(spans, ["MemoryStore", "Keeper", "remember", "recall"]);
});

test("extracts Java symbols when javac tools are available", { skip: !hasJavaTools() }, () => {
  const content = [
    "public class MemoryStore {",
    "    interface Keeper {",
    "        String remember(String text);",
    "    }",
    "",
    "    public String recall(String query) {",
    "        return query;",
    "    }",
    "",
    "    Runnable summarize = () -> {};",
    "}"
  ].join("\n");

  const spans = extractSymbolSpans("MemoryStore.java", content).map((item) => item.name);
  assert.deepEqual(spans, ["MemoryStore", "Keeper", "remember", "recall", "summarize"]);
});
