import { createServer } from "node:http";
import process from "node:process";

import next from "next";

import { isAllowedHost, localDashboardListenOptions } from "./lib/launcher";
import { getLaunchCode } from "./lib/security/runtime";

const options = localDashboardListenOptions();
const app = next({ dev: process.env.NODE_ENV !== "production", dir: process.cwd() });
const handler = app.getRequestHandler();

await app.prepare();

createServer((request, response) => {
  if (!isAllowedHost(request.headers.host)) {
    response.writeHead(421, { "content-type": "text/plain; charset=utf-8" });
    response.end("Local dashboard host required.");
    return;
  }
  void handler(request, response);
}).listen(options.port, options.host, () => {
  process.stdout.write(`Agent Memory Wiki local dashboard: http://${options.host}:${options.port}\n`);
  process.stdout.write(`One-time unlock code: ${getLaunchCode()}\n`);
});
