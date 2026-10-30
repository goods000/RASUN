import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { command, run, waitFor, stop, env, root } from "./process.mjs";
const runId = randomUUID();
Object.assign(env, { RASUN_DEV_RUN_ID: runId });
const stack = spawn(
  process.execPath,
  [path.join(root, "scripts/dev-local.mjs")],
  {
    cwd: root,
    env,
    stdio: "inherit",
    detached: process.platform !== "win32",
  },
);
let failure;
const controller = new AbortController();
try {
  let urls;
  const until = Date.now() + 120000;
  while (Date.now() < until) {
    if (stack.exitCode !== null || stack.signalCode)
      throw Error("Local stack stopped before UI readiness; see .local/logs");
    try {
      const candidate = JSON.parse(
        fs.readFileSync(
          path.join(root, ".local/runs", runId, "urls.json"),
          "utf8",
        ),
      );
      if (candidate.runId === runId) {
        urls = candidate;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (!urls) throw Error("Local UI readiness timed out");
  Object.assign(env, {
    RASUN_DAPP_URL: urls.dapp,
    RASUN_ADMIN_URL: urls.admin,
    TEST_API_URL: urls.api + "/api",
    TEST_RPC_URL: urls.chain,
    RASUN_LOCAL_RPC_URL: urls.chain,
    RPC_URL: urls.chain,
    DEPLOYMENT_FILE: urls.deployment,
    DATABASE_URL: urls.database,
    CONFIRMATIONS: "0",
  });
  await waitFor(
    urls.api + "/api/health",
    (h) => h.runId === runId && h.chain === "ready" && !h.index.error,
  );
  await run(["test:api"]);
  await run(["local:settle"]);
  await run(["test:ui"]);
} catch (e) {
  failure = e;
  console.error(e.message);
} finally {
  controller.abort();
  stop(stack);
}
process.exitCode = failure ? 1 : 0;
