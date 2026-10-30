import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
test("startup failure reports its diagnostic without a secondary module resolution error", () => {
  const result = spawnSync(process.execPath, ["scripts/dev-testnet.mjs"], {
    cwd: new URL("../../", import.meta.url),
    env: {
      ...process.env,
      DEPLOYMENT_FILE: ".local/no-such-test-deployment/config.json",
    },
    encoding: "utf8",
    timeout: 10000,
  });
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stderr, /Cannot find module/);
  assert.match(result.stderr, /Testnet startup failed/);
});
