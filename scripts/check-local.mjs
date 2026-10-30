import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import {
  command,
  run,
  waitFor,
  stop,
  assertFree,
  env,
  localOverrides,
  root,
} from "./process.mjs";
const runId = randomUUID();
Object.assign(env, localOverrides, { RASUN_DEV_RUN_ID: runId });
for (const port of [8545, 3000]) await assertFree(port);
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
  await Promise.race([
    new Promise((_, reject) => {
      stack.once("exit", (code) =>
        reject(Error("Local stack exited early: " + code)),
      );
      stack.once("error", reject);
    }),
    waitFor(
      "http://127.0.0.1:3000/api/health",
      (h) => h.chain === "ready" && !h.index.error,
      120000,
      controller.signal,
    ),
  ]);
  let urls;
  const until = Date.now() + 120000;
  while (Date.now() < until) {
    if (stack.exitCode !== null || stack.signalCode)
      throw Error("Local stack stopped before UI readiness; see .local/logs");
    try {
      const candidate = JSON.parse(
        fs.readFileSync(path.join(root, ".local/dev-urls.json"), "utf8"),
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
  });
  await run(["test:api"]);
  await run(["test:ui"]);
} catch (e) {
  failure = e;
  console.error(e.message);
} finally {
  controller.abort();
  stop(stack);
}
process.exitCode = failure ? 1 : 0;
