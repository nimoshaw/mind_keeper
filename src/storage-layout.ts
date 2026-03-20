import path from "node:path";
import { mindkeeperRoot } from "./config.js";

export const CANONICAL_MEMORY_SCHEMA_VERSION = 1;
export const PROFILE_INDEX_SCHEMA_VERSION = 1;
export const MINDKEEPER_LAYOUT_VERSION = 1;

export function canonicalRoot(projectRoot: string): string {
  return path.join(mindkeeperRoot(projectRoot), "canonical");
}

export function canonicalSchemaPath(projectRoot: string): string {
  return path.join(canonicalRoot(projectRoot), "schema.json");
}

export function canonicalContractPath(projectRoot: string): string {
  return path.join(canonicalRoot(projectRoot), "contract.json");
}

export function indexesRoot(projectRoot: string): string {
  return path.join(mindkeeperRoot(projectRoot), "indexes");
}

export function profileDirectoryName(profileName: string): string {
  return profileName.trim().replace(/[^a-zA-Z0-9._-]+/g, "_");
}

export function profileIndexRoot(projectRoot: string, profileName: string): string {
  return path.join(indexesRoot(projectRoot), profileDirectoryName(profileName));
}

export function profileIndexDescriptorPath(projectRoot: string, profileName: string): string {
  return path.join(profileIndexRoot(projectRoot, profileName), "profile.json");
}

export function legacyVectorRoot(projectRoot: string): string {
  return path.join(mindkeeperRoot(projectRoot), "vector");
}

export function domainsRoot(projectRoot: string): string {
  return path.join(mindkeeperRoot(projectRoot), "domains");
}

export function domainRoot(projectRoot: string, domainName: string): string {
  return path.join(domainsRoot(projectRoot), domainName);
}

export function domainConfigPath(projectRoot: string, domainName: string): string {
  return path.join(domainRoot(projectRoot, domainName), "domain.json");
}

export function domainSectionRoot(projectRoot: string, domainName: string, section: string): string {
  return path.join(domainRoot(projectRoot, domainName), section);
}

export function domainsIndexPath(projectRoot: string): string {
  return path.join(domainsRoot(projectRoot), "_index.json");
}
