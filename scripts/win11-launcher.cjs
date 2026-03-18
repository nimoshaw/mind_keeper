const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

async function main() {
  const releaseRoot = path.dirname(process.execPath);
  const appRoot = path.join(releaseRoot, "app");
  const entryPath = path.join(appRoot, "dist", "index.js");

  if (!fs.existsSync(entryPath)) {
    throw new Error(`Mind Keeper app payload not found: ${entryPath}`);
  }

  await import(pathToFileURL(entryPath).href);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(`[mind-keeper] launcher failed\n${message}`);
  process.exitCode = 1;
});
