import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { DomainConfig, DomainIndex, DomainIndexEntry, DomainSectionConfig } from "../types.js";
import { domainsRoot, domainRoot, domainConfigPath, domainSectionRoot, domainsIndexPath } from "../storage-layout.js";

/**
 * Registry for managing domain knowledge bases within a project.
 *
 * Each domain lives under `<projectRoot>/.mindkeeper/domains/<name>/` with a
 * `domain.json` descriptor that holds display name, aliases, sections, and tags.
 */
export class DomainRegistry {
  constructor(private readonly projectRoot: string) {}

  // ── Query ──────────────────────────────────────────────────────────

  /** List all registered domains. */
  async listDomains(): Promise<DomainConfig[]> {
    const root = domainsRoot(this.projectRoot);
    await fsp.mkdir(root, { recursive: true });

    const entries = await fsp.readdir(root, { withFileTypes: true });
    const domains: DomainConfig[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
      const config = await this.loadDomainConfig(entry.name);
      if (config) domains.push(config);
    }

    return domains;
  }

  /** Load a single domain config by directory name. Returns null if not found. */
  async loadDomainConfig(domainName: string): Promise<DomainConfig | null> {
    const configFile = domainConfigPath(this.projectRoot, domainName);
    try {
      const raw = await fsp.readFile(configFile, "utf8");
      return JSON.parse(raw) as DomainConfig;
    } catch {
      return null;
    }
  }

  /**
   * Resolve a domain by name OR any of its aliases (case-insensitive).
   * For example, "室内装修" or "装饰施工" can both resolve to the
   * "interior-construction" domain.
   */
  async resolveByAlias(query: string): Promise<DomainConfig | null> {
    const normalized = query.trim().toLowerCase();
    const domains = await this.listDomains();

    for (const domain of domains) {
      if (domain.name.toLowerCase() === normalized) return domain;
      if (domain.displayName.toLowerCase() === normalized) return domain;
      if (domain.aliases.some((a: string) => a.toLowerCase() === normalized)) return domain;
    }

    return null;
  }

  // ── Mutation ───────────────────────────────────────────────────────

  /** Create a new domain with metadata and optional sections. */
  async createDomain(input: {
    name: string;
    displayName: string;
    aliases?: string[];
    description?: string;
    tags?: string[];
    sections?: DomainSectionConfig[];
  }): Promise<DomainConfig> {
    const safeName = slugifyDomainName(input.name);
    const root = domainRoot(this.projectRoot, safeName);
    await fsp.mkdir(root, { recursive: true });

    const now = new Date().toISOString().split("T")[0];
    const config: DomainConfig = {
      name: safeName,
      displayName: input.displayName || input.name,
      aliases: input.aliases ?? [],
      description: input.description ?? "",
      tags: input.tags ?? [],
      sections: input.sections ?? [],
      createdAt: now,
      updatedAt: now
    };

    // Create section directories
    for (const section of config.sections) {
      await fsp.mkdir(domainSectionRoot(this.projectRoot, safeName, section.dir), { recursive: true });
    }

    await this.saveDomainConfig(safeName, config);
    await this.rebuildIndex();

    return config;
  }

  /** Update domain metadata (aliases, description, tags, display name). */
  async updateDomain(domainName: string, updates: {
    displayName?: string;
    aliases?: string[];
    description?: string;
    tags?: string[];
  }): Promise<DomainConfig | null> {
    const existing = await this.loadDomainConfig(domainName);
    if (!existing) return null;

    const updated: DomainConfig = {
      ...existing,
      ...pickDefined(updates),
      updatedAt: new Date().toISOString().split("T")[0]
    };

    await this.saveDomainConfig(domainName, updated);
    await this.rebuildIndex();

    return updated;
  }

  /** Add a section directory to an existing domain. */
  async addSection(domainName: string, section: DomainSectionConfig): Promise<DomainConfig | null> {
    const existing = await this.loadDomainConfig(domainName);
    if (!existing) return null;

    // Avoid duplicates
    if (existing.sections.some((s: DomainSectionConfig) => s.dir === section.dir)) return existing;

    existing.sections.push(section);
    existing.updatedAt = new Date().toISOString().split("T")[0];

    await fsp.mkdir(domainSectionRoot(this.projectRoot, domainName, section.dir), { recursive: true });
    await this.saveDomainConfig(domainName, existing);
    await this.rebuildIndex();

    return existing;
  }

  /** Remove a domain entirely. Returns true if it existed. */
  async deleteDomain(domainName: string): Promise<boolean> {
    const root = domainRoot(this.projectRoot, domainName);
    try {
      await fsp.rm(root, { recursive: true, force: true });
      await this.rebuildIndex();
      return true;
    } catch {
      return false;
    }
  }

  /** Add one or more aliases to a domain. */
  async addAliases(domainName: string, newAliases: string[]): Promise<DomainConfig | null> {
    const existing = await this.loadDomainConfig(domainName);
    if (!existing) return null;

    const combined = new Set([...existing.aliases, ...newAliases]);
    existing.aliases = Array.from(combined);
    existing.updatedAt = new Date().toISOString().split("T")[0];

    await this.saveDomainConfig(domainName, existing);
    await this.rebuildIndex();

    return existing;
  }

  /** Remove specific aliases from a domain. */
  async removeAliases(domainName: string, toRemove: string[]): Promise<DomainConfig | null> {
    const existing = await this.loadDomainConfig(domainName);
    if (!existing) return null;

    const removeSet = new Set(toRemove.map((a: string) => a.toLowerCase()));
    existing.aliases = existing.aliases.filter((a: string) => !removeSet.has(a.toLowerCase()));
    existing.updatedAt = new Date().toISOString().split("T")[0];

    await this.saveDomainConfig(domainName, existing);
    await this.rebuildIndex();

    return existing;
  }

  // ── Index ──────────────────────────────────────────────────────────

  /** Rebuild the `_index.json` file from all domains. */
  async rebuildIndex(): Promise<DomainIndex> {
    const domains = await this.listDomains();
    const entries: DomainIndexEntry[] = [];

    for (const domain of domains) {
      const fileCount = await this.countDomainFiles(domain.name);
      entries.push({
        name: domain.name,
        displayName: domain.displayName,
        aliases: domain.aliases,
        description: domain.description,
        tags: domain.tags,
        sectionCount: domain.sections.length,
        fileCount,
        updatedAt: domain.updatedAt
      });
    }

    const index: DomainIndex = {
      generatedAt: new Date().toISOString(),
      domains: entries
    };

    const indexPath = domainsIndexPath(this.projectRoot);
    await fsp.mkdir(path.dirname(indexPath), { recursive: true });
    await fsp.writeFile(indexPath, JSON.stringify(index, null, 2), "utf8");

    return index;
  }

  /** Read the current index, or rebuild if missing. */
  async readIndex(): Promise<DomainIndex> {
    const indexPath = domainsIndexPath(this.projectRoot);
    try {
      const raw = await fsp.readFile(indexPath, "utf8");
      return JSON.parse(raw) as DomainIndex;
    } catch {
      return this.rebuildIndex();
    }
  }

  // ── File Operations ────────────────────────────────────────────────

  /** List all .md files in a domain, optionally filtered by section. */
  async listDomainFiles(domainName: string, section?: string): Promise<string[]> {
    const root = section
      ? domainSectionRoot(this.projectRoot, domainName, section)
      : domainRoot(this.projectRoot, domainName);

    try {
      return await collectMdFiles(root);
    } catch {
      return [];
    }
  }

  /** Count all .md files across a domain's entire tree. */
  private async countDomainFiles(domainName: string): Promise<number> {
    try {
      const files = await collectMdFiles(domainRoot(this.projectRoot, domainName));
      return files.length;
    } catch {
      return 0;
    }
  }

  // ── Internal ───────────────────────────────────────────────────────

  private async saveDomainConfig(domainName: string, config: DomainConfig): Promise<void> {
    const configFile = domainConfigPath(this.projectRoot, domainName);
    await fsp.mkdir(path.dirname(configFile), { recursive: true });
    await fsp.writeFile(configFile, JSON.stringify(config, null, 2), "utf8");
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

function slugifyDomainName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s/\\]+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function pickDefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}

/** Recursively collect all `.md` files under a directory. */
async function collectMdFiles(dir: string): Promise<string[]> {
  const results: string[] = [];

  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith("_")) {
      results.push(...await collectMdFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(full);
    }
  }

  return results;
}
