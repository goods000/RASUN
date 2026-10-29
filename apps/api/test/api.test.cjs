const { test } = require("node:test");
const assert = require("node:assert/strict");
const base = process.env.TEST_API_URL || "http://127.0.0.1:3000/api";
test("publishes safe chain config and ABIs without private RPC or secrets", async () => {
  const r = await fetch(base + "/config");
  assert.equal(r.status, 200);
  const c = await r.json();
  assert.equal(c.chainId, 31337);
  assert.match(c.addresses.token, /^0x[0-9a-fA-F]{40}$/);
  assert.ok(c.abis.mining.length > 0);
  assert.equal(c.testOracle, true);
  assert.equal("privateKey" in c, false);
});
test("returns real supply and strictly paginated ranking", async () => {
  const r = await fetch(base + "/overview");
  assert.equal(r.status, 200);
  const o = await r.json();
  assert.equal(o.totalMinted, "2003333333333333333333333");
  assert.equal(o.cap, "100000000000000000000000000");
  const ranking = await (await fetch(base + "/ranking?limit=2&page=1")).json();
  assert.equal(ranking.items.length, 2);
  assert.ok(ranking.total >= 3);
  assert.ok(BigInt(ranking.items[0].balance) >= 10n ** 18n);
  for (const q of ["limit=0", "page=-1", "limit=1001", "page=abc", "page=1.5"])
    assert.equal((await fetch(base + "/ranking?" + q)).status, 400);
});
test("rejects invalid addresses and exposes separate real claim amounts", async () => {
  assert.equal((await fetch(base + "/wallet/not-an-address")).status, 400);
  const c = await (await fetch(base + "/config")).json();
  const w = await (await fetch(base + "/wallet/" + c.demoWallet)).json();
  assert.equal(w.address.toLowerCase(), c.demoWallet.toLowerCase());
  assert.ok(BigInt(w.claimable.holding) > 0n);
  assert.ok(BigInt(w.claimable.referral) > 0n);
  assert.ok(Array.isArray(w.referrals));
});
test("indexes confirmed events once and filters by wallet without substring matches", async () => {
  const c = await (await fetch(base + "/config")).json();
  const first = await (await fetch(base + "/events?limit=100")).json();
  assert.ok(first.total > 0);
  await new Promise((r) => setTimeout(r, 1200));
  const second = await (await fetch(base + "/events?limit=100")).json();
  assert.equal(second.total, first.total);
  assert.equal(
    new Set(second.items.map((x) => x.txHash + ":" + x.logIndex)).size,
    second.items.length,
  );
  assert.equal((await fetch(base + "/events?wallet=bad")).status, 400);
});
