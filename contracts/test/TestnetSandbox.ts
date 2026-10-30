import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
describe("TESTNET ONLY sandbox", function () {
  async function fixture() {
    const [owner, user, parent] = await ethers.getSigners();
    const token: any = await ethers.deployContract("TestnetRASUNToken", [
      ...Array(7).fill(owner.address),
      300,
    ]);
    const registry: any = await ethers.deployContract(
      "TestnetReferralRegistry",
      [token],
    );
    const quote: any = await ethers.deployContract("TestnetQuoteToken");
    const oracle: any = await ethers.deployContract("TestPriceOracle");
    const pool: any = await ethers.deployContract("TestnetSandboxPool", [
      token,
      quote,
      oracle,
    ]);
    const faucet: any = await ethers.deployContract("TestnetFaucet", [
      token,
      quote,
    ]);
    const mining: any = await ethers.deployContract("MiningRewards", [
      token,
      registry,
      await token.currentDay(),
    ]);
    await token.excludeFaucet(faucet);
    await token.transfer(pool, ethers.parseEther("1000000"));
    await quote.mint(pool, ethers.parseEther("500000"));
    await token.transfer(faucet, ethers.parseEther("100000"));
    await quote.transferOwnership(faucet);
    await oracle.transferOwnership(pool);
    await token.configure(mining, oracle, [pool]);
    await token.freeze();
    await pool.syncOracle();
    return {
      owner,
      user,
      parent,
      token,
      registry,
      quote,
      pool,
      faucet,
      mining,
    };
  }
  it("restricts epoch settings and rejects empty-pool trading", async () => {
    const [owner] = await ethers.getSigners();
    await expect(
      ethers.deployContract("TestnetRASUNToken", [
        ...Array(7).fill(owner.address),
        1,
      ]),
    ).revertedWith("INVALID_EPOCH");
    const { token, quote } = await fixture();
    const oracle = await ethers.deployContract("TestPriceOracle");
    const empty: any = await ethers.deployContract("TestnetSandboxPool", [
      token,
      quote,
      oracle,
    ]);
    expect(await empty.quoteBuy(1)).eq(0);
    expect(await empty.quoteSell(1)).eq(0);
    await expect(empty.buy(1, 0)).revertedWith("NO_LIQUIDITY");
    await expect(empty.sell(1, 0)).revertedWith("NO_LIQUIDITY");
  });
  it("allows another faucet claim only after a full real 24h", async () => {
    const { user, token, faucet } = await fixture();
    await faucet.connect(user).claim();
    await time.increaseTo((await faucet.nextClaimAt(user)) - 1n);
    await faucet.connect(user).claim();
    expect(await token.balanceOf(user)).eq(ethers.parseEther("200"));
  });
  it("uses the same accelerated clock for registry and actual mining rewards", async () => {
    const { owner, user, parent, token, registry, faucet, mining } =
      await fixture();
    await faucet.connect(user).claim();
    await registry.connect(user).bind(parent);
    const day = await token.currentDay();
    expect(await registry.boundDay(user)).eq(day);
    expect(await token.balanceAt(faucet, day)).eq(0);
    expect(await token.excluded(faucet)).eq(true);
    expect(await token.isPool(faucet)).eq(false);
    await expect(token.connect(user).excludeFaucet(parent)).reverted;
    await expect(token.connect(owner).excludeFaucet(faucet)).revertedWith(
      "LOCKED",
    );
    await time.increase(301);
    expect(await token.currentDay()).greaterThan(day);
    await mining.beginDay();
    while (await mining.activeDay()) await mining.process(128);
    expect((await mining.epochs(day)).finalized).eq(true);
    expect(await token.balanceOf(mining)).greaterThan(0);
    expect(await mining.pending(faucet, 0, 365)).eq(0);
    expect(await mining.pending(faucet, 1, 365)).eq(0);
    const pending = await mining.pending(user, 0, 365);
    expect(pending).greaterThan(0);
    const before = await token.balanceOf(user);
    await mining.connect(user).claim(0, 365);
    expect((await token.balanceOf(user)) - before).eq(pending);
  });
  it("escrows RASUN, limits claims to 24h, restricts test mint and trades with actual taxed outputs", async () => {
    const { user, token, quote, pool, faucet } = await fixture();
    await expect(quote.connect(user).mint(user, 1)).reverted;
    await faucet.connect(user).claim();
    expect(await token.balanceOf(user)).eq(ethers.parseEther("100"));
    await expect(faucet.connect(user).claim()).revertedWith("COOLDOWN");
    await quote.connect(user).approve(pool, ethers.MaxUint256);
    await token.connect(user).approve(pool, ethers.MaxUint256);
    const amount = ethers.parseEther("100");
    const gross = await pool.quoteBuy(amount);
    await expect(pool.connect(user).buy(amount, gross)).revertedWith("MIN_OUT");
    const before = await token.balanceOf(user);
    await pool.connect(user).buy(amount, (gross * 97n) / 100n);
    expect((await token.balanceOf(user)) - before).eq(
      gross - (gross / 100n) * 3n,
    );
    const out = await pool.quoteSell(amount);
    const qb = await quote.balanceOf(user);
    await pool.connect(user).sell(amount, out);
    expect((await quote.balanceOf(user)) - qb).gte(out);
    await expect(
      pool.connect(user).sell(amount, ethers.MaxUint256),
    ).revertedWith("MIN_OUT");
    expect(await token.totalBurned()).greaterThan(0);
    await pool.connect(user).syncOracle();
    expect(await faucet.nextClaimAt(user)).greaterThan(await time.latest());
  });
});
