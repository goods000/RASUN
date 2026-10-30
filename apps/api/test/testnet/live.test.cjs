const { test } = require("node:test");
const assert = require("node:assert/strict");
const { JsonRpcProvider, Contract, Wallet } = require("ethers");
const base = process.env.TESTNET_API_URL;
test(
  "TESTNET/FIXTURE API matches deployed RPC reserves, balances, allowances and clock",
  { skip: !base },
  async () => {
    const provider = new JsonRpcProvider(process.env.BSC_TESTNET_RPC_URL);
    try {
      const config = await (await fetch(base + "/config")).json();
      assert.equal(config.sandbox, true);
      assert.equal(config.mode, "testnet");
      assert.ok([97, 31337].includes(config.chainId));
      assert.equal(
        Number((await provider.getNetwork()).chainId),
        config.chainId,
      );
      for (const name of [
        "token",
        "registry",
        "mining",
        "oracle",
        "quote",
        "pool",
        "faucet",
      ]) {
        assert.ok(config.abis[name].length);
        assert.notEqual(await provider.getCode(config.addresses[name]), "0x");
      }
      const account = Wallet.createRandom().address;
      const market = await (
        await fetch(base + "/market?wallet=" + account)
      ).json();
      const make = (n) =>
        new Contract(config.addresses[n], config.abis[n], provider);
      const [
        reserves,
        balance,
        quoteAllowance,
        tokenAllowance,
        native,
        claim,
        current,
      ] = await Promise.all([
        make("pool").reserves(),
        make("quote").balanceOf(account),
        make("quote").allowance(account, config.addresses.pool),
        make("token").allowance(account, config.addresses.pool),
        provider.getBalance(account),
        make("faucet").nextClaimAt(account),
        make("token").currentDay(),
      ]);
      assert.deepEqual(market.reserves, {
        token: String(reserves[0]),
        quote: String(reserves[1]),
      });
      assert.equal(market.quoteBalance, String(balance));
      assert.deepEqual(market.allowances, {
        quote: String(quoteAllowance),
        token: String(tokenAllowance),
      });
      assert.equal(market.nativeBalance, String(native));
      assert.equal(market.faucet.nextClaimAt, String(claim));
      assert.equal(market.currentEpoch, String(current));
      assert.equal(
        market.nextEpochAt,
        String((current + 1n) * BigInt(config.epochSeconds) - 28800n),
      );
      assert.equal((await fetch(base + "/market?wallet=bad")).status, 400);
      const overview = await (await fetch(base + "/overview")).json();
      assert.equal(overview.epochSeconds, config.epochSeconds);
      assert.equal(overview.accelerated, config.accelerated);
      assert.equal(
        overview.nextEpochAt,
        String(
          (BigInt(overview.currentDay) + 1n) * BigInt(config.epochSeconds) -
            28800n,
        ),
      );
    } finally {
      provider.destroy();
    }
  },
);
