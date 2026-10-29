const { test } = require("node:test");
const assert = require("node:assert/strict");
const { JsonRpcProvider, Contract, Wallet } = require("ethers");
const base = process.env.TEST_API_URL || "http://127.0.0.1:3000/api";
async function waitFor(check) {
  for (let i = 0; i < 60; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw Error("Indexer did not converge");
}
test("rolls orphaned events back and replays the replacement branch", async () => {
  const cfg = await (await fetch(base + "/config")).json();
  const rpc = new JsonRpcProvider("http://127.0.0.1:8545", undefined, {
    cacheTimeout: -1,
  });
  const signer = await rpc.getSigner(1);
  const token = new Contract(cfg.addresses.token, cfg.abis.token, signer);
  const snapshot = await rpc.send("evm_snapshot", []);
  try {
    const first = await token.transfer(Wallet.createRandom().address, 123n);
    await first.wait();
    const events = async () => {
      const r = await fetch(base + "/events?limit=100");
      return r.ok ? (await r.json()).items : [];
    };
    await waitFor(async () =>
      (await events()).some((e) => e.txHash === first.hash),
    );
    await rpc.send("evm_revert", [snapshot]);
    const second = await token.transfer(Wallet.createRandom().address, 456n);
    await second.wait();
    await waitFor(async () => {
      const e = await events();
      return (
        !e.some((x) => x.txHash === first.hash) &&
        e.some((x) => x.txHash === second.hash)
      );
    });
    const all = await events();
    assert.equal(
      all.filter((e) => e.txHash === second.hash && e.name === "Transfer")
        .length,
      1,
    );
  } finally {
    rpc.destroy();
  }
});
