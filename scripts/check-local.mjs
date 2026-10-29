import { command, run, waitFor, stop, assertFree } from "./process.mjs";
for (const port of [8545, 3000, 5173, 5174]) await assertFree(port);
const stack = command(["dev:local"], {
  detached: process.platform !== "win32",
});
let failure;
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
    ),
  ]);
  await run(["test:api"]);
  await run(["test:ui"]);
} catch (e) {
  failure = e;
  console.error(e.message);
} finally {
  stop(stack);
}
process.exitCode = failure ? 1 : 0;
