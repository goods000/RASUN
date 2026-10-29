const { test } = require("node:test");
const assert = require("node:assert/strict");
test("RPC outage produces explicit service unavailable instead of made-up supply", async () => {
  const saved = process.env.RPC_URL;
  process.env.RPC_URL = "http://127.0.0.1:9";
  const { ChainService } = require("../dist/chain.service.js");
  const service = new ChainService();
  try {
    await assert.rejects(
      () => service.overview(),
      (e) => e.getStatus() === 503 && /unavailable/.test(e.message),
    );
  } finally {
    service.provider.destroy();
    if (saved === undefined) delete process.env.RPC_URL;
    else process.env.RPC_URL = saved;
  }
});
