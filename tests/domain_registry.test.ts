import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DomainRegistry } from "../src/app/domain-registry.js";

async function createProjectRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "mk-domain-test-"));
}

test("domain registry: create domain with metadata and sections", async () => {
  const projectRoot = await createProjectRoot();
  try {
    const registry = new DomainRegistry(projectRoot);
    const domain = await registry.createDomain({
      name: "Coffee Knowledge",
      displayName: "咖啡专业知识",
      aliases: ["coffee", "咖啡"],
      description: "Everything about specialty coffee",
      tags: ["food", "beverage"],
      sections: [
        { dir: "beans", label: "咖啡豆" },
        { dir: "brewing", label: "冲泡方法" }
      ]
    });

    assert.equal(domain.name, "coffee-knowledge");
    assert.equal(domain.displayName, "咖啡专业知识");
    assert.deepEqual(domain.aliases, ["coffee", "咖啡"]);
    assert.equal(domain.sections.length, 2);

    // Verify directory was created
    const stat = await fs.stat(path.join(projectRoot, ".mindkeeper", "domains", "coffee-knowledge"));
    assert.ok(stat.isDirectory());

    // Verify section directories
    const beansStat = await fs.stat(path.join(projectRoot, ".mindkeeper", "domains", "coffee-knowledge", "beans"));
    assert.ok(beansStat.isDirectory());

    // Verify domain.json
    const configRaw = await fs.readFile(
      path.join(projectRoot, ".mindkeeper", "domains", "coffee-knowledge", "domain.json"),
      "utf8"
    );
    const config = JSON.parse(configRaw);
    assert.equal(config.displayName, "咖啡专业知识");
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("domain registry: slugifies domain names with slashes and spaces", async () => {
  const projectRoot = await createProjectRoot();
  try {
    const registry = new DomainRegistry(projectRoot);
    const domain = await registry.createDomain({
      name: "Interior Design / Construction",
      displayName: "室内装修"
    });

    assert.equal(domain.name, "interior-design-construction");
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("domain registry: resolves by exact name", async () => {
  const projectRoot = await createProjectRoot();
  try {
    const registry = new DomainRegistry(projectRoot);
    await registry.createDomain({
      name: "interior-construction",
      displayName: "室内装修",
      aliases: ["装饰施工", "室内装修", "interior design"]
    });

    const result = await registry.resolveByAlias("interior-construction");
    assert.ok(result);
    assert.equal(result.name, "interior-construction");
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("domain registry: resolves by displayName", async () => {
  const projectRoot = await createProjectRoot();
  try {
    const registry = new DomainRegistry(projectRoot);
    await registry.createDomain({
      name: "interior-construction",
      displayName: "室内装修",
      aliases: ["装饰施工"]
    });

    const result = await registry.resolveByAlias("室内装修");
    assert.ok(result);
    assert.equal(result.name, "interior-construction");
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("domain registry: resolves by alias including Chinese names", async () => {
  const projectRoot = await createProjectRoot();
  try {
    const registry = new DomainRegistry(projectRoot);
    await registry.createDomain({
      name: "interior-construction",
      displayName: "室内装修",
      aliases: ["装饰施工", "interior design", "装潢"]
    });

    const result1 = await registry.resolveByAlias("装饰施工");
    assert.ok(result1);
    assert.equal(result1.name, "interior-construction");

    const result2 = await registry.resolveByAlias("Interior Design");
    assert.ok(result2);
    assert.equal(result2.name, "interior-construction");
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("domain registry: returns null for unknown alias", async () => {
  const projectRoot = await createProjectRoot();
  try {
    const registry = new DomainRegistry(projectRoot);
    const result = await registry.resolveByAlias("nonexistent");
    assert.equal(result, null);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("domain registry: list domains returns empty array when none exist", async () => {
  const projectRoot = await createProjectRoot();
  try {
    const registry = new DomainRegistry(projectRoot);
    const domains = await registry.listDomains();
    assert.deepEqual(domains, []);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("domain registry: list domains returns all registered domains", async () => {
  const projectRoot = await createProjectRoot();
  try {
    const registry = new DomainRegistry(projectRoot);
    await registry.createDomain({ name: "coffee", displayName: "咖啡" });
    await registry.createDomain({ name: "tea", displayName: "茶" });

    const domains = await registry.listDomains();
    assert.equal(domains.length, 2);
    const names = domains.map((d: { name: string }) => d.name).sort();
    assert.deepEqual(names, ["coffee", "tea"]);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("domain registry: update domain metadata", async () => {
  const projectRoot = await createProjectRoot();
  try {
    const registry = new DomainRegistry(projectRoot);
    await registry.createDomain({
      name: "coffee",
      displayName: "咖啡",
      aliases: ["coffee"]
    });

    const updated = await registry.updateDomain("coffee", {
      displayName: "精品咖啡",
      tags: ["specialty"]
    });

    assert.ok(updated);
    assert.equal(updated.displayName, "精品咖啡");
    assert.deepEqual(updated.tags, ["specialty"]);
    assert.deepEqual(updated.aliases, ["coffee"]);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("domain registry: update returns null for nonexistent domain", async () => {
  const projectRoot = await createProjectRoot();
  try {
    const registry = new DomainRegistry(projectRoot);
    const result = await registry.updateDomain("nope", { displayName: "x" });
    assert.equal(result, null);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("domain registry: add section creates directory", async () => {
  const projectRoot = await createProjectRoot();
  try {
    const registry = new DomainRegistry(projectRoot);
    await registry.createDomain({ name: "coffee", displayName: "咖啡" });

    const result = await registry.addSection("coffee", { dir: "beans", label: "咖啡豆" });
    assert.ok(result);
    assert.equal(result.sections.length, 1);
    assert.equal(result.sections[0].dir, "beans");

    const stat = await fs.stat(path.join(projectRoot, ".mindkeeper", "domains", "coffee", "beans"));
    assert.ok(stat.isDirectory());
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("domain registry: add aliases without duplicates", async () => {
  const projectRoot = await createProjectRoot();
  try {
    const registry = new DomainRegistry(projectRoot);
    await registry.createDomain({
      name: "coffee",
      displayName: "咖啡",
      aliases: ["coffee"]
    });

    const result = await registry.addAliases("coffee", ["coffee", "espresso", "拿铁"]);
    assert.ok(result);
    assert.ok(result.aliases.includes("coffee"));
    assert.ok(result.aliases.includes("espresso"));
    assert.ok(result.aliases.includes("拿铁"));
    assert.equal(result.aliases.filter((a: string) => a === "coffee").length, 1);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("domain registry: remove aliases", async () => {
  const projectRoot = await createProjectRoot();
  try {
    const registry = new DomainRegistry(projectRoot);
    await registry.createDomain({
      name: "coffee",
      displayName: "咖啡",
      aliases: ["espresso", "拿铁", "americano"]
    });

    const result = await registry.removeAliases("coffee", ["拿铁", "americano"]);
    assert.ok(result);
    assert.deepEqual(result.aliases, ["espresso"]);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("domain registry: delete domain removes directory", async () => {
  const projectRoot = await createProjectRoot();
  try {
    const registry = new DomainRegistry(projectRoot);
    await registry.createDomain({ name: "coffee", displayName: "咖啡" });

    const deleted = await registry.deleteDomain("coffee");
    assert.ok(deleted);

    const domains = await registry.listDomains();
    assert.equal(domains.length, 0);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("domain registry: generates _index.json", async () => {
  const projectRoot = await createProjectRoot();
  try {
    const registry = new DomainRegistry(projectRoot);
    await registry.createDomain({
      name: "coffee",
      displayName: "咖啡",
      aliases: ["java"],
      sections: [{ dir: "beans", label: "Beans" }]
    });

    const index = await registry.readIndex();
    assert.equal(index.domains.length, 1);
    assert.equal(index.domains[0].name, "coffee");
    assert.equal(index.domains[0].sectionCount, 1);
    assert.ok(index.domains[0].aliases.includes("java"));

    const indexPath = path.join(projectRoot, ".mindkeeper", "domains", "_index.json");
    const raw = await fs.readFile(indexPath, "utf8");
    const parsed = JSON.parse(raw);
    assert.equal(parsed.domains.length, 1);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("domain registry: list domain files recursively", async () => {
  const projectRoot = await createProjectRoot();
  try {
    const registry = new DomainRegistry(projectRoot);
    await registry.createDomain({
      name: "coffee",
      displayName: "咖啡",
      sections: [{ dir: "beans", label: "Beans" }]
    });

    const beansDir = path.join(projectRoot, ".mindkeeper", "domains", "coffee", "beans");
    await fs.writeFile(path.join(beansDir, "arabica.md"), "# Arabica\nFine coffee bean.", "utf8");

    const files = await registry.listDomainFiles("coffee");
    assert.equal(files.length, 1);
    assert.ok(files[0].includes("arabica.md"));
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("domain registry: list domain files by section", async () => {
  const projectRoot = await createProjectRoot();
  try {
    const registry = new DomainRegistry(projectRoot);
    await registry.createDomain({
      name: "coffee",
      displayName: "咖啡",
      sections: [
        { dir: "beans", label: "Beans" },
        { dir: "brewing", label: "Brewing" }
      ]
    });

    const beansDir = path.join(projectRoot, ".mindkeeper", "domains", "coffee", "beans");
    const brewingDir = path.join(projectRoot, ".mindkeeper", "domains", "coffee", "brewing");
    await fs.writeFile(path.join(beansDir, "arabica.md"), "# Arabica", "utf8");
    await fs.writeFile(path.join(brewingDir, "espresso.md"), "# Espresso", "utf8");

    const beansFiles = await registry.listDomainFiles("coffee", "beans");
    assert.equal(beansFiles.length, 1);
    assert.ok(beansFiles[0].includes("arabica.md"));

    const brewingFiles = await registry.listDomainFiles("coffee", "brewing");
    assert.equal(brewingFiles.length, 1);
    assert.ok(brewingFiles[0].includes("espresso.md"));
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});
