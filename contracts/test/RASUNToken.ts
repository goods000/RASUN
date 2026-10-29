import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
const E = ethers.parseEther;
export async function foundation() {
  const [owner, miner, lp, tech, ops, dao, stabilizer, alice, bob, pool] =
    await ethers.getSigners();
  const token: any = await ethers.deployContract("RASUNToken", [
    owner.address,
    miner.address,
    lp.address,
    tech.address,
    ops.address,
    dao.address,
    stabilizer.address,
  ]);
  const oracle: any = await ethers.deployContract("TestPriceOracle");
  const registry: any = await ethers.deployContract("ReferralRegistry");
  return {
    owner,
    miner,
    lp,
    tech,
    ops,
    dao,
    stabilizer,
    alice,
    bob,
    pool,
    token,
    oracle,
    registry,
  };
}
describe("RASUN token and referral foundations", () => {
  it("splits initial supply and removes arbitrary owner issuance", async () => {
    const { token, miner, lp, owner } = await foundation();
    expect(await token.balanceOf(miner)).eq(E("1000000"));
    expect(await token.balanceOf(lp)).eq(E("1000000"));
    expect(await token.totalMinted()).eq(E("2000000"));
    await expect(token.mintReward(1, owner.address, 1)).reverted;
  });
  it("retains past end-of-day balance after subsequent transfers", async () => {
    const { token, miner, alice, bob } = await foundation();
    await token.connect(miner).transfer(alice, E("100"));
    const day = await token.currentDay();
    await time.increaseTo(Number((day + 1n) * 86400n - 28800n));
    await token.connect(alice).transfer(bob, E("25"));
    expect(await token.balanceAt(alice, day)).eq(E("100"));
    expect(await token.balanceAt(alice, day + 1n)).eq(E("75"));
    expect(await token.holderCountAt(day)).eq(1n);
  });
  it("charges buy 3%, sell 5%, and transfers untaxed", async () => {
    const {
      token,
      oracle,
      registry,
      miner,
      lp,
      owner,
      alice,
      bob,
      pool,
      tech,
      ops,
      dao,
    } = await foundation();
    await token.connect(lp).transfer(pool, E("1000"));
    await token.configure(registry, oracle, [pool.address]);
    await token.freeze();
    await oracle.setPrices(E("0.5"), E("0.5"), await token.currentDay());
    await token.connect(pool).transfer(alice, E("100"));
    expect(await token.balanceOf(alice)).eq(E("97"));
    expect(await token.balanceOf(tech)).eq(E("1"));
    expect(await token.balanceOf(ops)).eq(E("1"));
    await token.connect(miner).transfer(alice, E("100"));
    await token.connect(alice).transfer(bob, E("10"));
    expect(await token.balanceOf(bob)).eq(E("10"));
    await token.connect(alice).transfer(pool, E("100"));
    expect(await token.balanceOf(dao)).eq(E("2"));
    expect(await token.totalSupply()).eq(E("1999998"));
    expect(await token.totalMinted()).eq(E("2000000"));
    await expect(token.configure(registry, oracle, [])).reverted;
  });
  for (const [price, extra] of [
    ["0.451", 0],
    ["0.45", 5],
    ["0.4", 10],
    ["0.35", 15],
  ] as const) {
    it(`applies crash tier ${extra}% at ${price}`, async () => {
      const { token, oracle, registry, owner, miner, alice, pool, stabilizer } =
        await foundation();
      await token.configure(registry, oracle, [pool.address]);
      await token.freeze();
      await oracle.setPrices(E(price), E("0.5"), await token.currentDay());
      await token.connect(miner).transfer(alice, E("100"));
      await token.connect(alice).transfer(pool, E("100"));
      expect(await token.balanceOf(pool)).eq(E(String(95 - extra)));
      expect(await token.balanceOf(stabilizer)).eq(E(String(extra / 2)));
    });
  }
  it("rejects missing/stale sale quotes but preserves transfers", async () => {
    const { token, oracle, registry, owner, miner, alice, bob, pool } =
      await foundation();
    await token.configure(registry, oracle, [pool.address]);
    await token.freeze();
    await token.connect(miner).transfer(alice, E("100"));
    await expect(token.connect(alice).transfer(pool, E("1"))).reverted;
    await token.connect(alice).transfer(bob, E("1"));
    await oracle.setPrices(E("0.5"), E("0.5"), await token.currentDay());
    await time.increase(3601);
    await expect(token.connect(alice).transfer(pool, E("1"))).reverted;
  });
  it("binds only once, rejects self and cycles, and snapshots invite time", async () => {
    const { registry, alice, bob, miner } = await foundation();
    await expect(registry.connect(alice).bind(alice)).reverted;
    await registry.connect(alice).bind(bob);
    await expect(registry.connect(alice).bind(miner)).reverted;
    await expect(registry.connect(bob).bind(alice)).reverted;
    const d = BigInt(Math.floor(((await time.latest()) + 28800) / 86400));
    expect(await registry.inviterAt(alice, d)).eq(bob.address);
    expect(await registry.inviterAt(alice, d - 1n)).eq(ethers.ZeroAddress);
  });
});

describe("Cumulative cap security", () => {
  it("does not restore issuance allowance after a taxed burn", async () => {
    const { token, registry, oracle, miner, pool } = await foundation();
    await token.configure(registry, oracle, [pool.address]);
    await token.freeze();
    const day = await token.currentDay();
    await oracle.setPrices(E("0.5"), E("0.5"), day);
    const minter = await registry.getAddress();
    await ethers.provider.send("hardhat_impersonateAccount", [minter]);
    await ethers.provider.send("hardhat_setBalance", [
      minter,
      "0x56BC75E2D63100000",
    ]);
    const signer = await ethers.getSigner(minter);
    try {
      await token.connect(signer).mintReward(day - 1n, minter, E("98000000"));
      await token.connect(miner).transfer(pool, E("100"));
      expect(await token.totalSupply()).eq(E("99999999"));
      await time.increaseTo(Number((day + 1n) * 86400n - 28800n));
      await expect(
        token.connect(signer).mintReward(day, minter, 1n),
      ).revertedWith("CAP_EXCEEDED");
    } finally {
      await ethers.provider.send("hardhat_stopImpersonatingAccount", [minter]);
    }
  });
});
