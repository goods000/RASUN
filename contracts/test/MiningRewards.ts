import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { foundation } from "./RASUNToken";
const E = ethers.parseEther;
async function setup() {
  const f = await foundation();
  const day = await f.token.currentDay();
  const mining: any = await ethers.deployContract("MiningRewards", [
    f.token,
    f.registry,
    day,
  ]);
  await f.token.configure(mining, f.oracle, [f.pool.address]);
  await f.token.freeze();
  return { ...f, mining, day };
}
async function finish(m: any, batch = 128) {
  await m.beginDay();
  let txs = 1,
    gas = 0n;
  while ((await m.activeDay()) !== 0n) {
    const r = await (await m.process(batch)).wait();
    gas += r.gasUsed;
    if (++txs > 20000) throw Error("settlement failed to terminate");
  }
  return { txs, gas };
}
async function next(day: bigint) {
  await time.increaseTo(Number((day + 1n) * 86400n - 28800n));
}
describe("Full-chain mining", () => {
  it("uses exact thirty-day monthly emissions and new-stage growth", async () => {
    const { mining, day } = await setup();
    let sum = 0n;
    for (let d = 0n; d < 30n; d++) sum += await mining.emission(day + d);
    expect(sum).eq(E("100000"));
    expect(await mining.monthlyEmission(5)).eq(E("161051"));
    expect(await mining.monthlyEmission(6)).eq(E("169103.55"));
    expect(await mining.emission(day - 1n)).eq(0n);
    let cumulative = 0n;
    for (let m = 0; m < 100; m++) cumulative += await mining.monthlyEmission(m);
    expect(cumulative).eq(E("98000000"));
  });
  it("uses competition rank, excludes dust and freezes past balances", async () => {
    const { mining, token, miner, alice, bob, day } = await setup();
    const users = await ethers.getSigners();
    const c = users[10],
      dust = users[11];
    for (const [u, v] of [
      [alice, "100"],
      [bob, "100"],
      [c, "101"],
      [dust, "0.9"],
    ] as const)
      await token.connect(miner).transfer(u, E(v));
    await next(day);
    await token.connect(alice).transfer(bob, E("50"));
    await finish(mining, 3);
    expect(await mining.weight(day, alice, 0)).eq(1n);
    expect(await mining.weight(day, bob, 0)).eq(1n);
    expect(await mining.weight(day, c, 0)).eq(3n);
    expect(await mining.weight(day, dust, 0)).eq(0n);
    const pool = (await mining.emission(day)) / 2n;
    expect(await mining.rewards(day, alice, 0)).eq(pool / 5n);
    const sum =
      (await mining.rewards(day, alice, 0)) +
      (await mining.rewards(day, bob, 0)) +
      (await mining.rewards(day, c, 0));
    expect(sum).eq(pool);
    expect(await mining.unallocated()).eq((await mining.emission(day)) - pool);
  });
  it("matches document referral examples with exact fixed-point cube root", async () => {
    const { mining, token, registry, miner, alice, day } = await setup();
    for (const amount of ["100000", "10000", "1500", "800", "600"]) {
      const w = ethers.Wallet.createRandom().connect(ethers.provider);
      await ethers.provider.send("hardhat_setBalance", [
        w.address,
        "0x56BC75E2D63100000",
      ]);
      await registry.connect(w).bind(alice);
      await token.connect(miner).transfer(w, E(amount));
    }
    await token.connect(miner).transfer(alice, E("1"));
    await next(day);
    await finish(mining);
    expect(await mining.weight(day, alice, 1))
      .gte(E("43546.41588833612"))
      .lt(E("43546.41588833613"));
  });
  it("keeps categories independent, accumulates days and prevents double claim", async () => {
    const { mining, token, registry, miner, alice, bob, day } = await setup();
    await token.connect(miner).transfer(alice, E("10"));
    await token.connect(miner).transfer(bob, E("20"));
    await registry.connect(bob).bind(alice);
    await next(day);
    await finish(mining);
    await next(day + 1n);
    await finish(mining, 7);
    const holding = await mining.pending(alice, 0, 30),
      referral = await mining.pending(alice, 1, 30);
    expect(holding).gt(0);
    expect(referral).gt(0);
    const before = await token.balanceOf(alice);
    await mining.connect(alice).claim(0, 30);
    expect(await token.balanceOf(alice)).eq(before + holding);
    expect(await mining.pending(alice, 0, 30)).eq(0n);
    expect(await mining.pending(alice, 1, 30)).eq(referral);
    await expect(mining.connect(alice).claim(0, 30)).revertedWith(
      "NOTHING_TO_CLAIM",
    );
    await mining.connect(alice).claim(1, 30);
    expect(await mining.pending(alice, 1, 30)).eq(0n);
  });
  it("finishes empty days and cannot settle current/future days", async () => {
    const { mining, day } = await setup();
    await expect(mining.beginDay()).reverted;
    await next(day);
    await finish(mining);
    expect(await mining.nextDay()).eq(day + 1n);
    expect(await mining.unallocated()).eq(await mining.emission(day));
  });
  it("settles 100 participating accounts with bounded operations and records gas", async () => {
    const { mining, token, miner, day } = await setup();
    for (let i = 0; i < 100; i++)
      await token
        .connect(miner)
        .transfer(ethers.Wallet.createRandom().address, E(String(i + 1)));
    await next(day);
    const report = await finish(mining, 256);
    console.log(
      "100-account settlement:",
      report.txs,
      "transactions,",
      String(report.gas),
      "gas",
    );
    expect(await mining.nextDay()).eq(day + 1n);
    expect(report.txs).lt(100);
  });
});

describe("Historical settlement adversarial cases", () => {
  it("gives zero-balance inviters referral power only after the binding day", async () => {
    const { mining, token, registry, miner, alice, bob, day } = await setup();
    await token.connect(miner).transfer(bob, E("1000"));
    await next(day);
    await registry.connect(bob).bind(alice);
    await finish(mining, 2);
    expect(await mining.weight(day, alice, 1)).eq(0n);
    await next(day + 1n);
    await finish(mining, 5);
    expect(await mining.weight(day + 1n, alice, 1)).eq(E("10"));
    expect(await mining.weight(day + 1n, alice, 0)).eq(0n);
    expect(await mining.pending(alice, 1, 365)).gt(0n);
  });
  it("produces identical rewards regardless of processing batch boundaries", async () => {
    const { mining, token, miner, alice, bob, day } = await setup();
    await token.connect(miner).transfer(alice, E("100"));
    await token.connect(miner).transfer(bob, E("101"));
    await next(day);
    const snapshot = await ethers.provider.send("evm_snapshot", []);
    await finish(mining, 1);
    const small = [
      await mining.rewards(day, alice, 0),
      await mining.rewards(day, bob, 0),
    ];
    await ethers.provider.send("evm_revert", [snapshot]);
    await finish(mining, 512);
    expect([
      await mining.rewards(day, alice, 0),
      await mining.rewards(day, bob, 0),
    ]).deep.eq(small);
    await expect(mining.process(0)).reverted;
  });
});
