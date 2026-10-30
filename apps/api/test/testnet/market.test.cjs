require("reflect-metadata");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ChainService } = require("../../dist/chain.service");
function service() {
  const s = Object.create(ChainService.prototype);
  s.config = {
    sandbox: true,
    epochSeconds: 300,
    accelerated: true,
    addresses: { pool: "pool" },
  };
  s.ready = async () => {};
  s.token = { currentDay: async () => 103n, allowance: async () => 11n };
  s.quote = { balanceOf: async () => 12n, allowance: async () => 13n };
  s.pool = { reserves: async () => [20n, 30n] };
  s.faucet = { nextClaimAt: async () => 2000n };
  s.provider = {
    getBalance: async () => 99n,
    getBlock: async () => ({ timestamp: 2100 }),
  };
  return s;
}
test("market returns real wei strings and epoch time", async () => {
  const s = service();
  const m = await s.market("0x0000000000000000000000000000000000000001");
  assert.deepEqual(m.reserves, { token: "20", quote: "30" });
  assert.equal(m.quoteBalance, "12");
  assert.equal(m.nativeBalance, "99");
  assert.deepEqual(m.allowances, { token: "11", quote: "13" });
  assert.equal(m.faucet.available, true);
  assert.equal(m.nextEpochAt, "2400");
});
test("market rejects invalid wallet and non sandbox", async () => {
  await assert.rejects(service().market("bad"), /Invalid wallet/);
  const s = service();
  s.config.sandbox = false;
  await assert.rejects(s.market(), (e) => e.status === 404);
});
test("anonymous market has no invented wallet balances", async () => {
  const m = await service().market();
  assert.equal(m.quoteBalance, null);
  assert.equal(m.nativeBalance, null);
  assert.deepEqual(m.faucet, { nextClaimAt: null, available: false });
});
test("sandbox readiness verifies every deployed contract and clock metadata", async () => {
  const s = service();
  delete s.ready;
  s.config = {
    ...s.config,
    mode: "testnet",
    chainId: 97,
    addresses: { token: "token", pool: "pool", faucet: "faucet" },
  };
  s.provider = {
    getNetwork: async () => ({ chainId: 97n }),
    getCode: async (a) => (a === "pool" ? "0x" : "0x12"),
  };
  await assert.rejects(s.ready(), /unavailable/);
  s.provider.getCode = async () => "0x12";
  s.token = { epochSeconds: async () => 300n };
  await s.ready();
  s.token.epochSeconds = async () => 86400n;
  await assert.rejects(s.ready(), /unavailable/);
});
test("market and overview daily epoch boundaries retain UTC+8 offset", async () => {
  const s = service();
  s.config.epochSeconds = 86400;
  s.config.accelerated = false;
  Object.assign(s.token, {
    currentDay: async () => 20000n,
    totalMinted: async () => 1n,
    totalSupply: async () => 1n,
    totalBurned: async () => 0n,
    MAX_SUPPLY: async () => 100n,
  });
  s.mining = {
    nextDay: async () => 20000n,
    activeDay: async () => 0n,
    startDay: async () => 20000n,
    unallocated: async () => 0n,
    emission: async () => 1n,
  };
  s.oracle = {
    quote: async () => {
      throw Error("unavailable oracle");
    },
  };
  const expected = String(20001n * 86400n - 28800n);
  assert.equal((await s.market()).nextEpochAt, expected);
  const o = await s.overview();
  assert.equal(o.nextEpochAt, expected);
  assert.equal(o.currentEpoch, "20000");
  assert.equal(o.accelerated, false);
});
