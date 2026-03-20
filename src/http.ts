/**
 * HTTP API entry point for Mind Keeper.
 *
 * Usage:
 *   node dist/http.js                              # defaults: 127.0.0.1:6700
 *   node dist/http.js --port 8080                   # custom port
 *   MIND_KEEPER_PROJECT_ROOT=D:/myproject node dist/http.js  # default project
 */
import { startHttpServer } from "./http-server.js";

const portArg = process.argv.indexOf("--port");
const port = portArg !== -1 && process.argv[portArg + 1]
  ? Number.parseInt(process.argv[portArg + 1], 10)
  : undefined;

const hostArg = process.argv.indexOf("--host");
const host = hostArg !== -1 ? process.argv[hostArg + 1] : undefined;

const projectRootArg = process.argv.indexOf("--project-root");
const projectRoot = projectRootArg !== -1 ? process.argv[projectRootArg + 1] : undefined;

startHttpServer({ port, host, projectRoot }).catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[mind-keeper] HTTP startup error\n${message}`);
  process.exitCode = 1;
});
