import path from "node:path";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import ts from "typescript";

export interface SymbolSpan {
  name: string;
  index: number;
}

export function detectLanguage(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".ts":
    case ".tsx":
      return "typescript";
    case ".js":
    case ".jsx":
      return "javascript";
    case ".py":
      return "python";
    case ".go":
      return "go";
    case ".rs":
      return "rust";
    case ".java":
      return "java";
    case ".cs":
      return "csharp";
    case ".c":
    case ".h":
    case ".cpp":
    case ".hpp":
      return "cpp";
    case ".json":
      return "json";
    case ".yaml":
    case ".yml":
      return "yaml";
    case ".toml":
      return "toml";
    case ".md":
      return "markdown";
    case ".sql":
      return "sql";
    case ".sh":
      return "shell";
    case ".ps1":
      return "powershell";
    default:
      return null;
  }
}

export function inferSymbolName(
  fileLabel: string,
  content: string,
  allowLabelFallback = true,
  filePath = fileLabel,
  useParser = true
): string | null {
  if (useParser) {
    const parsedSpans = extractSymbolSpans(filePath, content);
    if (parsedSpans[0]?.name) {
      return parsedSpans[0].name;
    }
  }

  const snippet = content.slice(0, 2000);
  const patterns = [
    /export\s+(?:async\s+)?function\s+([A-Za-z_]\w*)/m,
    /function\s+([A-Za-z_]\w*)\s*\(/m,
    /export\s+class\s+([A-Za-z_]\w*)/m,
    /class\s+([A-Za-z_]\w*)\s*/m,
    /^\s*(?:public|private|protected)?\s*(?:static\s+)?(?:async\s+)?([A-Za-z_]\w*)\s*\([^)]*\)[^\n]*\{/m,
    /const\s+([A-Za-z_]\w*)\s*=\s*(?:async\s*)?\(/m,
    /const\s+([A-Za-z_]\w*)\s*=\s*(?:async\s*)?(?:function|<)/m,
    /interface\s+([A-Za-z_]\w*)/m,
    /type\s+([A-Za-z_]\w*)\s*=/m,
    /def\s+([A-Za-z_]\w*)\s*\(/m,
    /struct\s+([A-Za-z_]\w*)/m,
    /enum\s+([A-Za-z_]\w*)/m
  ];

  for (const pattern of patterns) {
    const match = snippet.match(pattern);
    if (match?.[1] && !isReservedSymbol(match[1])) {
      return match[1];
    }
  }

  if (!allowLabelFallback) {
    return null;
  }

  const cleaned = fileLabel.replace(path.extname(fileLabel), "").trim();
  return cleaned || null;
}

export function extractSymbolSpans(filePath: string, content: string): SymbolSpan[] {
  const language = detectLanguage(filePath);
  if (language === "typescript" || language === "javascript") {
    const spans = extractTsSymbolSpans(filePath, content);
    if (spans.length > 0) {
      return spans;
    }
  }

  if (language === "python") {
    const spans = extractPythonSymbolSpans(filePath, content);
    if (spans.length > 0) {
      return spans;
    }
  }

  if (language === "go") {
    const spans = extractGoSymbolSpans(filePath, content);
    if (spans.length > 0) {
      return spans;
    }
  }

  if (language === "rust") {
    const spans = extractRustSymbolSpans(filePath, content);
    if (spans.length > 0) {
      return spans;
    }
  }

  if (language === "java") {
    const spans = extractJavaSymbolSpans(filePath, content);
    if (spans.length > 0) {
      return spans;
    }
  }

  return extractRegexSymbolSpans(content);
}

export function symbolForChunk(spans: SymbolSpan[], chunkStart: number, chunkEnd: number): string | null {
  let insideChunk: string | null = null;
  for (const span of spans) {
    if (span.index >= chunkStart && span.index < chunkEnd) {
      insideChunk = span.name;
    }
    if (span.index >= chunkEnd) {
      break;
    }
  }

  if (insideChunk) {
    return insideChunk;
  }

  let chosen: string | null = null;
  for (const span of spans) {
    if (span.index <= chunkStart) {
      chosen = span.name;
      continue;
    }
    break;
  }
  return chosen;
}

function extractTsSymbolSpans(filePath: string, content: string): SymbolSpan[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFromPath(filePath)
  );
  const spans: SymbolSpan[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      pushSpan(spans, node.name.text, node.name.getStart(sourceFile));
    } else if (ts.isClassDeclaration(node) && node.name) {
      pushSpan(spans, node.name.text, node.name.getStart(sourceFile));
    } else if (ts.isInterfaceDeclaration(node)) {
      pushSpan(spans, node.name.text, node.name.getStart(sourceFile));
    } else if (ts.isTypeAliasDeclaration(node)) {
      pushSpan(spans, node.name.text, node.name.getStart(sourceFile));
    } else if (ts.isEnumDeclaration(node)) {
      pushSpan(spans, node.name.text, node.name.getStart(sourceFile));
    } else if (
      (ts.isMethodDeclaration(node) || ts.isMethodSignature(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) &&
      node.name
    ) {
      const name = propertyNameText(node.name);
      if (name) {
        pushSpan(spans, name, node.name.getStart(sourceFile));
      }
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer) || ts.isClassExpression(node.initializer))
    ) {
      pushSpan(spans, node.name.text, node.name.getStart(sourceFile));
    } else if (
      ts.isPropertyAssignment(node) &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      const name = propertyNameText(node.name);
      if (name) {
        pushSpan(spans, name, node.name.getStart(sourceFile));
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  spans.sort((a, b) => a.index - b.index);
  return dedupeSymbolSpans(spans);
}

function extractRegexSymbolSpans(content: string): SymbolSpan[] {
  const patterns = [
    /export\s+(?:async\s+)?function\s+([A-Za-z_]\w*)/gm,
    /function\s+([A-Za-z_]\w*)\s*\(/gm,
    /export\s+class\s+([A-Za-z_]\w*)/gm,
    /class\s+([A-Za-z_]\w*)\s*/gm,
    /^\s*(?:public|private|protected)?\s*(?:static\s+)?(?:async\s+)?([A-Za-z_]\w*)\s*\([^)]*\)[^\n]*\{/gm,
    /const\s+([A-Za-z_]\w*)\s*=\s*(?:async\s*)?\(/gm,
    /interface\s+([A-Za-z_]\w*)/gm,
    /type\s+([A-Za-z_]\w*)\s*=/gm,
    /def\s+([A-Za-z_]\w*)\s*\(/gm
  ];

  const spans: SymbolSpan[] = [];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      if (match.index !== undefined && match[1] && !isReservedSymbol(match[1])) {
        spans.push({ name: match[1], index: match.index });
      }
    }
  }

  spans.sort((a, b) => a.index - b.index);
  return dedupeSymbolSpans(spans);
}

function extractPythonSymbolSpans(filePath: string, content: string): SymbolSpan[] {
  const script = [
    "import ast, json, sys",
    "content = sys.stdin.read()",
    "line_offsets = [0]",
    "for line in content.splitlines(True):",
    "    line_offsets.append(line_offsets[-1] + len(line))",
    "def to_index(node):",
    "    line = getattr(node, 'lineno', None)",
    "    col = getattr(node, 'col_offset', None)",
    "    if line is None or col is None:",
    "        return 0",
    "    if line - 1 >= len(line_offsets):",
    "        return len(content)",
    "    return line_offsets[line - 1] + col",
    "try:",
    "    tree = ast.parse(content, filename=sys.argv[1] if len(sys.argv) > 1 else '<memory>')",
    "except SyntaxError:",
    "    print('[]')",
    "    raise SystemExit(0)",
    "spans = []",
    "class Visitor(ast.NodeVisitor):",
    "    def visit_FunctionDef(self, node):",
    "        spans.append({'name': node.name, 'index': to_index(node)})",
    "        self.generic_visit(node)",
    "    def visit_AsyncFunctionDef(self, node):",
    "        spans.append({'name': node.name, 'index': to_index(node)})",
    "        self.generic_visit(node)",
    "    def visit_ClassDef(self, node):",
    "        spans.append({'name': node.name, 'index': to_index(node)})",
    "        self.generic_visit(node)",
    "Visitor().visit(tree)",
    "print(json.dumps(spans))"
  ].join("\n");

  for (const command of pythonCommandCandidates()) {
    try {
      const result = execFileSync(command.file, [...command.args, script, filePath], {
        input: content,
        encoding: "utf8",
        windowsHide: true,
        maxBuffer: 1024 * 1024
      });
      const parsed = JSON.parse(result) as Array<{ name?: string; index?: number }>;
      const spans = parsed
        .filter((item) => typeof item.name === "string" && typeof item.index === "number")
        .map((item) => ({ name: item.name as string, index: item.index as number }))
        .filter((item) => !isReservedSymbol(item.name));
      if (spans.length > 0) {
        spans.sort((a, b) => a.index - b.index);
        return dedupeSymbolSpans(spans);
      }
      return [];
    } catch {
      continue;
    }
  }

  return [];
}

function extractGoSymbolSpans(filePath: string, content: string): SymbolSpan[] {
  try {
    const binaryPath = ensureGoParserTool();
    const result = execFileSync(binaryPath, [], {
      input: content,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        MIND_KEEPER_SOURCE_PATH: filePath
      }
    });

    const parsed = JSON.parse(result) as Array<{ name?: string; index?: number }>;
    const spans = parsed
      .filter((item) => typeof item.name === "string" && typeof item.index === "number")
      .map((item) => ({ name: item.name as string, index: item.index as number }))
      .filter((item) => !isReservedSymbol(item.name));

    if (spans.length === 0) {
      return [];
    }

    spans.sort((a, b) => a.index - b.index);
    return dedupeSymbolSpans(spans);
  } catch {
    return [];
  }
}

function extractRustSymbolSpans(filePath: string, content: string): SymbolSpan[] {
  try {
    const parserRoot = ensureRustParserTool();
    const manifestPath = path.join(parserRoot, "Cargo.toml");
    const result = execFileSync("cargo", ["run", "--quiet", "--manifest-path", manifestPath], {
      input: content,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 8,
      env: {
        ...process.env,
        CARGO_TARGET_DIR: path.join(parserRoot, "target"),
        MIND_KEEPER_SOURCE_PATH: filePath
      }
    });

    const parsed = JSON.parse(result) as Array<{ name?: string; index?: number }>;
    const spans = parsed
      .filter((item) => typeof item.name === "string" && typeof item.index === "number")
      .map((item) => ({ name: item.name as string, index: item.index as number }))
      .filter((item) => !isReservedSymbol(item.name));

    if (spans.length === 0) {
      return [];
    }

    spans.sort((a, b) => a.index - b.index);
    return dedupeSymbolSpans(spans);
  } catch {
    return [];
  }
}

function extractJavaSymbolSpans(filePath: string, content: string): SymbolSpan[] {
  try {
    const parserRoot = ensureJavaParserTool();
    const classPath = path.join(parserRoot, "bin");
    const toolsJar = resolveJavaToolsJar();
    const result = execFileSync("java", ["-cp", javaClassPath([classPath, toolsJar]), "MindKeeperJavaParser"], {
      input: content,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 4,
      env: {
        ...process.env,
        MIND_KEEPER_SOURCE_PATH: filePath
      }
    });

    const parsed = JSON.parse(result) as Array<{ name?: string; index?: number }>;
    const spans = parsed
      .filter((item) => typeof item.name === "string" && typeof item.index === "number")
      .map((item) => ({ name: item.name as string, index: item.index as number }))
      .filter((item) => !isReservedSymbol(item.name));

    if (spans.length === 0) {
      return [];
    }

    spans.sort((a, b) => a.index - b.index);
    return dedupeSymbolSpans(spans);
  } catch {
    return [];
  }
}

function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return isReservedSymbol(name.text) ? null : name.text;
  }
  return null;
}

function pushSpan(spans: SymbolSpan[], name: string, index: number): void {
  if (!name || isReservedSymbol(name)) {
    return;
  }
  spans.push({ name, index });
}

function dedupeSymbolSpans(spans: SymbolSpan[]): SymbolSpan[] {
  const seen = new Set<string>();
  const output: SymbolSpan[] = [];
  for (const span of spans) {
    const key = `${span.name}:${span.index}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(span);
  }
  return output;
}

function scriptKindFromPath(filePath: string): ts.ScriptKind {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".ts":
      return ts.ScriptKind.TS;
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".js":
      return ts.ScriptKind.JS;
    case ".jsx":
      return ts.ScriptKind.JSX;
    default:
      return ts.ScriptKind.Unknown;
  }
}

function pythonCommandCandidates(): Array<{ file: string; args: string[] }> {
  return [
    { file: "py", args: ["-3", "-c"] },
    { file: "python", args: ["-c"] },
    { file: "python3", args: ["-c"] }
  ];
}

function ensureRustParserTool(): string {
  const root = path.join(os.tmpdir(), "mind-keeper-rust-parser");
  const srcDir = path.join(root, "src");
  const cargoTomlPath = path.join(root, "Cargo.toml");
  const mainRsPath = path.join(srcDir, "main.rs");
  const cargoToml = rustParserCargoToml();
  const mainRs = rustParserProgram();

  mkdirSync(srcDir, { recursive: true });
  writeFileIfChanged(cargoTomlPath, cargoToml);
  writeFileIfChanged(mainRsPath, mainRs);

  return root;
}

function ensureGoParserTool(): string {
  const root = path.join(os.tmpdir(), "mind-keeper-go-parser");
  const srcDir = path.join(root, "src");
  const parserPath = path.join(srcDir, "main.go");
  const binaryPath = path.join(root, process.platform === "win32" ? "mind-keeper-go-parser.exe" : "mind-keeper-go-parser");
  const source = goParserProgram();

  mkdirSync(srcDir, { recursive: true });
  const changed = writeFileIfChanged(parserPath, source);

  if (changed || !existsSync(binaryPath)) {
    execFileSync("go", ["build", "-o", binaryPath, parserPath], {
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 8
    });
    if (process.platform !== "win32") {
      chmodSync(binaryPath, 0o755);
    }
  }

  return binaryPath;
}

function ensureJavaParserTool(): string {
  const root = path.join(os.tmpdir(), "mind-keeper-java-parser");
  const srcPath = path.join(root, "MindKeeperJavaParser.java");
  const binDir = path.join(root, "bin");
  const classPath = path.join(binDir, "MindKeeperJavaParser.class");
  const source = javaParserProgram();
  const toolsJar = resolveJavaToolsJar();

  mkdirSync(root, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  const changed = writeFileIfChanged(srcPath, source);

  if (changed || !existsSync(classPath)) {
    execFileSync("javac", ["-cp", javaClassPath([toolsJar]), "-d", binDir, srcPath], {
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 4
    });
  }

  return root;
}

function writeFileIfChanged(filePath: string, content: string): boolean {
  if (existsSync(filePath)) {
    const current = readFileSync(filePath, "utf8");
    if (current === content) {
      return false;
    }
  }
  writeFileSync(filePath, content, "utf8");
  return true;
}

function resolveJavaToolsJar(): string {
  const candidates: string[] = [];
  for (const envName of ["JAVA_HOME", "JDK_HOME"]) {
    const base = process.env[envName];
    if (base) {
      candidates.push(path.join(base, "lib", "tools.jar"));
    }
  }

  try {
    const output = execFileSync("where.exe", ["javac"], {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 1024 * 1024
    });
    for (const line of output.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
      candidates.push(path.join(path.dirname(path.dirname(line)), "lib", "tools.jar"));
    }
  } catch {
    // Ignore and rely on environment-based candidates.
  }

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error("Unable to locate Java tools.jar for parser-backed Java symbol extraction.");
}

function javaClassPath(entries: string[]): string {
  return entries.filter(Boolean).join(path.delimiter);
}

function goParserProgram(): string {
  return [
    "package main",
    "",
    "import (",
    '  "encoding/json"',
    '  "go/ast"',
    '  "go/parser"',
    '  "go/token"',
    '  "io"',
    '  "os"',
    ")",
    "",
    "type Span struct {",
    '  Name string `json:"name"`',
    '  Index int `json:"index"`',
    "}",
    "",
    "func main() {",
    "  content, err := io.ReadAll(os.Stdin)",
    "  if err != nil {",
    "    _, _ = os.Stdout.WriteString(\"[]\")",
    "    return",
    "  }",
    "",
    '  filename := os.Getenv("MIND_KEEPER_SOURCE_PATH")',
    '  if filename == "" {',
    '    filename = "<memory>"',
    "  }",
    "",
    "  fset := token.NewFileSet()",
    "  file, err := parser.ParseFile(fset, filename, content, parser.AllErrors)",
    "  if err != nil || file == nil {",
    "    _, _ = os.Stdout.WriteString(\"[]\")",
    "    return",
    "  }",
    "",
    "  spans := make([]Span, 0)",
    "  push := func(name string, pos token.Pos) {",
    '    if name == "" {',
    "      return",
    "    }",
    "    position := fset.PositionFor(pos, false)",
    "    spans = append(spans, Span{Name: name, Index: position.Offset})",
    "  }",
    "",
    "  for _, decl := range file.Decls {",
    "    switch node := decl.(type) {",
    "    case *ast.FuncDecl:",
    "      if node.Name != nil {",
    "        push(node.Name.Name, node.Name.Pos())",
    "      }",
    "    case *ast.GenDecl:",
    "      for _, spec := range node.Specs {",
    "        switch typed := spec.(type) {",
    "        case *ast.TypeSpec:",
    "          if typed.Name != nil {",
    "            push(typed.Name.Name, typed.Name.Pos())",
    "          }",
    "        case *ast.ValueSpec:",
    "          for i, name := range typed.Names {",
    "            if i < len(typed.Values) {",
    "              if _, ok := typed.Values[i].(*ast.FuncLit); ok && name != nil {",
    "                push(name.Name, name.Pos())",
    "              }",
    "            }",
    "          }",
    "        }",
    "      }",
    "    }",
    "  }",
    "",
    "  output, err := json.Marshal(spans)",
    "  if err != nil {",
    "    _, _ = os.Stdout.WriteString(\"[]\")",
    "    return",
    "  }",
    "  _, _ = os.Stdout.Write(output)",
    "}",
    ""
  ].join("\n");
}

function rustParserCargoToml(): string {
  return [
    '[package]',
    'name = "mind_keeper_rust_parser"',
    'version = "0.1.0"',
    'edition = "2021"',
    "",
    "[dependencies]",
    'proc-macro2 = { version = "1", features = ["span-locations"] }',
    'serde = { version = "1", features = ["derive"] }',
    'serde_json = "1"',
    'syn = { version = "2", features = ["full", "visit"] }',
    ""
  ].join("\n");
}

function rustParserProgram(): string {
  return [
    "use proc_macro2::LineColumn;",
    "use serde::Serialize;",
    "use std::io::{self, Read};",
    "use syn::visit::Visit;",
    "",
    "#[derive(Serialize)]",
    "struct Span {",
    "    name: String,",
    "    index: usize,",
    "}",
    "",
    "struct Collector<'a> {",
    "    content: &'a str,",
    "    spans: Vec<Span>,",
    "}",
    "",
    "impl<'a> Collector<'a> {",
    "    fn push(&mut self, name: &str, start: LineColumn) {",
    "        if name.is_empty() {",
    "            return;",
    "        }",
    "        self.spans.push(Span {",
    "            name: name.to_string(),",
    "            index: line_column_to_index(self.content, start),",
    "        });",
    "    }",
    "}",
    "",
    "impl<'ast, 'a> Visit<'ast> for Collector<'a> {",
    "    fn visit_item_fn(&mut self, node: &'ast syn::ItemFn) {",
    "        self.push(&node.sig.ident.to_string(), node.sig.ident.span().start());",
    "        syn::visit::visit_item_fn(self, node);",
    "    }",
    "",
    "    fn visit_item_struct(&mut self, node: &'ast syn::ItemStruct) {",
    "        self.push(&node.ident.to_string(), node.ident.span().start());",
    "        syn::visit::visit_item_struct(self, node);",
    "    }",
    "",
    "    fn visit_item_enum(&mut self, node: &'ast syn::ItemEnum) {",
    "        self.push(&node.ident.to_string(), node.ident.span().start());",
    "        syn::visit::visit_item_enum(self, node);",
    "    }",
    "",
    "    fn visit_item_trait(&mut self, node: &'ast syn::ItemTrait) {",
    "        self.push(&node.ident.to_string(), node.ident.span().start());",
    "        syn::visit::visit_item_trait(self, node);",
    "    }",
    "",
    "    fn visit_item_type(&mut self, node: &'ast syn::ItemType) {",
    "        self.push(&node.ident.to_string(), node.ident.span().start());",
    "        syn::visit::visit_item_type(self, node);",
    "    }",
    "",
    "    fn visit_item_const(&mut self, node: &'ast syn::ItemConst) {",
    "        self.push(&node.ident.to_string(), node.ident.span().start());",
    "        syn::visit::visit_item_const(self, node);",
    "    }",
    "",
    "    fn visit_item_static(&mut self, node: &'ast syn::ItemStatic) {",
    "        self.push(&node.ident.to_string(), node.ident.span().start());",
    "        syn::visit::visit_item_static(self, node);",
    "    }",
    "",
    "    fn visit_item_trait_alias(&mut self, node: &'ast syn::ItemTraitAlias) {",
    "        self.push(&node.ident.to_string(), node.ident.span().start());",
    "        syn::visit::visit_item_trait_alias(self, node);",
    "    }",
    "",
    "    fn visit_impl_item_fn(&mut self, node: &'ast syn::ImplItemFn) {",
    "        self.push(&node.sig.ident.to_string(), node.sig.ident.span().start());",
    "        syn::visit::visit_impl_item_fn(self, node);",
    "    }",
    "",
    "    fn visit_trait_item_fn(&mut self, node: &'ast syn::TraitItemFn) {",
    "        self.push(&node.sig.ident.to_string(), node.sig.ident.span().start());",
    "        syn::visit::visit_trait_item_fn(self, node);",
    "    }",
    "}",
    "",
    "fn line_column_to_index(content: &str, start: LineColumn) -> usize {",
    "    let mut line = 1usize;",
    "    let mut column = 0usize;",
    "    for (index, ch) in content.char_indices() {",
    "        if line == start.line && column == start.column {",
    "            return index;",
    "        }",
    "        if ch == '\\n' {",
    "            line += 1;",
    "            column = 0;",
    "        } else {",
    "            column += 1;",
    "        }",
    "    }",
    "    content.len()",
    "}",
    "",
    "fn main() {",
    "    let mut content = String::new();",
    "    if io::stdin().read_to_string(&mut content).is_err() {",
    "        println!(\"[]\");",
    "        return;",
    "    }",
    "",
    "    let parsed = syn::parse_file(&content);",
    "    let file = match parsed {",
    "        Ok(file) => file,",
    "        Err(_) => {",
    "            println!(\"[]\");",
    "            return;",
    "        }",
    "    };",
    "",
    "    let mut collector = Collector {",
    "        content: &content,",
    "        spans: Vec::new(),",
    "    };",
    "    collector.visit_file(&file);",
    "",
    "    match serde_json::to_string(&collector.spans) {",
    "        Ok(output) => println!(\"{}\", output),",
    "        Err(_) => println!(\"[]\"),",
    "    }",
    "}",
    ""
  ].join("\n");
}

function javaParserProgram(): string {
  return [
    "import com.sun.source.tree.*;",
    "import com.sun.source.util.*;",
    "import javax.tools.*;",
    "import java.io.*;",
    "import java.net.URI;",
    "import java.nio.charset.StandardCharsets;",
    "import java.util.*;",
    "",
    "public class MindKeeperJavaParser {",
    "    public static void main(String[] args) throws Exception {",
    "        String content = readAll();",
    '        String filename = System.getenv("MIND_KEEPER_SOURCE_PATH");',
    '        if (filename == null || filename.isEmpty()) {',
    '            filename = "Memory.java";',
    "        }",
    "",
    "        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();",
    "        if (compiler == null) {",
    '            System.out.println("[]");',
    "            return;",
    "        }",
    "",
    "        JavaFileObject file = new SourceFileObject(filename, content);",
    "        DiagnosticCollector<JavaFileObject> diagnostics = new DiagnosticCollector<JavaFileObject>();",
    "        JavacTask task = (JavacTask) compiler.getTask(",
    "            null,",
    "            null,",
    "            diagnostics,",
    '            Arrays.asList("-proc:none"),',
    "            null,",
    "            Arrays.asList(file)",
    "        );",
    "",
    "        Iterable<? extends CompilationUnitTree> roots;",
    "        try {",
    "            roots = task.parse();",
    "        } catch (Throwable error) {",
    '            System.out.println("[]");',
    "            return;",
    "        }",
    "",
    "        Trees trees = Trees.instance(task);",
    "        SourcePositions positions = trees.getSourcePositions();",
    "        List<Span> spans = new ArrayList<Span>();",
    "",
    "        for (CompilationUnitTree root : roots) {",
    "            new TreePathScanner<Void, Void>() {",
    "                @Override",
    "                public Void visitClass(ClassTree node, Void unused) {",
    "                    String name = node.getSimpleName().toString();",
    '                    if (!name.isEmpty()) {',
    "                        long start = positions.getStartPosition(root, node);",
    "                        if (start >= 0) {",
    "                            spans.add(new Span(name, (int) start));",
    "                        }",
    "                    }",
    "                    return super.visitClass(node, unused);",
    "                }",
    "",
    "                @Override",
    "                public Void visitMethod(MethodTree node, Void unused) {",
    "                    String name = node.getName().toString();",
    '                    if (!name.isEmpty() && !"<init>".equals(name) && !"<clinit>".equals(name)) {',
    "                        long start = positions.getStartPosition(root, node);",
    "                        if (start >= 0) {",
    "                            spans.add(new Span(name, (int) start));",
    "                        }",
    "                    }",
    "                    return super.visitMethod(node, unused);",
    "                }",
    "",
    "                @Override",
    "                public Void visitVariable(VariableTree node, Void unused) {",
    "                    Tree parent = getCurrentPath() != null && getCurrentPath().getParentPath() != null",
    "                        ? getCurrentPath().getParentPath().getLeaf()",
    "                        : null;",
    "                    if (parent != null && parent.getKind() == Tree.Kind.ENUM) {",
    "                        return super.visitVariable(node, unused);",
    "                    }",
    "                    if (node.getType() == null) {",
    "                        return super.visitVariable(node, unused);",
    "                    }",
    "                    ExpressionTree initializer = node.getInitializer();",
    "                    if (initializer != null) {",
    "                        Tree.Kind kind = initializer.getKind();",
    "                        if (kind == Tree.Kind.LAMBDA_EXPRESSION || kind == Tree.Kind.NEW_CLASS) {",
    "                            String name = node.getName().toString();",
    '                            if (!name.isEmpty()) {',
    "                                long start = positions.getStartPosition(root, node);",
    "                                if (start >= 0) {",
    "                                    spans.add(new Span(name, (int) start));",
    "                                }",
    "                            }",
    "                        }",
    "                    }",
    "                    return super.visitVariable(node, unused);",
    "                }",
    "            }.scan(root, null);",
    "        }",
    "",
    "        Collections.sort(spans, new Comparator<Span>() {",
    "            @Override",
    "            public int compare(Span left, Span right) {",
    "                return Integer.compare(left.index, right.index);",
    "            }",
    "        });",
    "",
    "        System.out.println(toJson(spans));",
    "    }",
    "",
    "    private static String readAll() throws IOException {",
    "        ByteArrayOutputStream buffer = new ByteArrayOutputStream();",
    "        byte[] chunk = new byte[4096];",
    "        int read;",
    "        while ((read = System.in.read(chunk)) != -1) {",
    "            buffer.write(chunk, 0, read);",
    "        }",
    "        return new String(buffer.toByteArray(), StandardCharsets.UTF_8);",
    "    }",
    "",
    "    private static String toJson(List<Span> spans) {",
    "        StringBuilder builder = new StringBuilder();",
    '        builder.append("[");',
    "        for (int i = 0; i < spans.size(); i += 1) {",
    "            if (i > 0) {",
    '                builder.append(",");',
    "            }",
    "            Span span = spans.get(i);",
    '            builder.append("{\\"name\\":\\"")',
    "                .append(escape(span.name))",
    '                .append("\\",\\"index\\":")',
    "                .append(span.index)",
    '                .append("}");',
    "        }",
    '        builder.append("]");',
    "        return builder.toString();",
    "    }",
    "",
    "    private static String escape(String input) {",
    '        return input.replace("\\\\", "\\\\\\\\").replace("\\"", "\\\\\\"");',
    "    }",
    "",
    "    private static final class Span {",
    "        final String name;",
    "        final int index;",
    "",
    "        Span(String name, int index) {",
    "            this.name = name;",
    "            this.index = index;",
    "        }",
    "    }",
    "",
    "    private static final class SourceFileObject extends SimpleJavaFileObject {",
    "        private final String content;",
    "",
    "        SourceFileObject(String filename, String content) {",
    '            super(URI.create("string:///" + filename.replace("\\\\", "/")), Kind.SOURCE);',
    "            this.content = content;",
    "        }",
    "",
    "        @Override",
    "        public CharSequence getCharContent(boolean ignoreEncodingErrors) {",
    "            return content;",
    "        }",
    "    }",
    "}",
    ""
  ].join("\n");
}

function isReservedSymbol(name: string): boolean {
  return new Set(["if", "for", "while", "switch", "catch", "return", "async"]).has(name.toLowerCase());
}
