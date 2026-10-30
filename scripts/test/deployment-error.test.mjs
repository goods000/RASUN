import { test } from "node:test";
import assert from "node:assert/strict";
import diagnostics from "../deployment-error.cjs";
test("deployment errors identify failure class without exposing provider credentials", () => {
  for (const [error, expected] of [
    [
      {
        code: "NETWORK_ERROR",
        message: "secret-key https://user:password@rpc.invalid",
      },
      "RPC_NETWORK",
    ],
    [
      { code: "INSUFFICIENT_FUNDS", message: "raw secret-key" },
      "INSUFFICIENT_FUNDS",
    ],
    [
      { code: "CALL_EXCEPTION", message: "raw secret-key" },
      "TRANSACTION_REVERTED",
    ],
    [
      { error: { code: "ETIMEDOUT" }, message: "raw secret-key" },
      "RPC_NETWORK",
    ],
    [{ message: "HTTP 429 secret-key" }, "RPC_RATE_LIMIT"],
    [{ code: "NONCE_EXPIRED", message: "raw secret-key" }, "NONCE_CONFLICT"],
    [{ message: "secret-key" }, "UNKNOWN"],
  ]) {
    const result = diagnostics.deploymentError(error, "RPC chain check");
    assert.match(result, new RegExp(expected));
    assert.match(result, /RPC chain check/);
    assert.ok(!result.includes("secret-key") && !result.includes("password"));
  }
});
