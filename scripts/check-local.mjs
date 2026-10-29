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
Object.assign(env, localOverrides);
for (const port of [8545, 3000, 5173, 5174]) await assertFree(port);
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
