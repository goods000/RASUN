import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
test("deployment wrapper rejects malformed signing keys without echoing secrets", () => {
  const secret = "private-invalid-DO-NOT-ECHO";
  const result = spawnSync(process.execPath, ["scripts/deploy-testnet.mjs"], {
    cwd: new URL("../../", import.meta.url),
    env: { ...process.env, DEPLOYER_PRIVATE_KEY: secret },
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /valid DEPLOYER_PRIVATE_KEY/);
  assert.ok(!(result.stderr + result.stdout).includes(secret));
});
