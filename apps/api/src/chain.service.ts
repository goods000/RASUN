import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Contract, JsonRpcProvider, formatEther } from "ethers";
import { deployment, address, jsonSafe, paging } from "./config";
@Injectable()
export class ChainService {
  config: any;
  provider: JsonRpcProvider;
  token: Contract;
  mining: Contract;
  registry: Contract;
  oracle: Contract;
  quote: Contract;
  pool: Contract;
  faucet: Contract;
  constructor() {
    this.provider = new JsonRpcProvider(
      process.env.RPC_URL || "http://127.0.0.1:8545",
      undefined,
      { cacheTimeout: -1 },
    );
    try {
      this.config = deployment();
    } catch {
      this.config = null;
    }
    const c = this.config;
    const make = (k: string) =>
      new Contract(
        c?.addresses[k] || "0x0000000000000000000000000000000000000000",
        c?.abis[k] || [],
        this.provider,
      );
    this.token = make("token");
    this.mining = make("mining");
    this.registry = make("registry");
    this.oracle = make("oracle");
    this.quote = make("quote");
    this.pool = make("pool");
    this.faucet = make("faucet");
  }
  async ready() {
    if (!this.config)
      throw new ServiceUnavailableException(
        "Deployment not configured. Run local:deploy first.",
      );
    try {
      if (
        Number((await this.provider.getNetwork()).chainId) !==
        this.config.chainId
      )
        throw Error("Chain mismatch");
      const names = this.config.sandbox
        ? ["token", "registry", "mining", "oracle", "quote", "pool", "faucet"]
        : ["token"];
      if (
        this.config.sandbox &&
        (![97, 31337].includes(this.config.chainId) ||
          this.config.mode !== "testnet" ||
          !Number.isSafeInteger(this.config.epochSeconds) ||
          this.config.epochSeconds < 1 ||
          this.config.accelerated !== (this.config.epochSeconds !== 86400))
      )
        throw Error("Invalid sandbox metadata");
      await Promise.all(
        names.map(async (name) => {
          if (
            (await this.provider.getCode(this.config.addresses[name])) === "0x"
          )
            throw Error("Missing deployment");
        }),
      );
      if (
        this.config.sandbox &&
        Number(await this.token.epochSeconds()) !== this.config.epochSeconds
      )
        throw Error("Epoch clock metadata mismatch");
    } catch {
      throw new ServiceUnavailableException(
        "Configured chain or contracts are unavailable",
      );
    }
  }
  async guard<T>(fn: () => Promise<T>) {
    await this.ready();
    try {
      return jsonSafe(await fn());
    } catch (e) {
      if (e instanceof ServiceUnavailableException) throw e;
      throw new ServiceUnavailableException(
        "Chain query failed; retry after RPC recovers",
      );
    }
  }
  publicConfig() {
    if (!this.config)
      throw new ServiceUnavailableException("Deployment not configured");
    const c = this.config;
    return {
      chainId: c.chainId,
      network: c.network,
      mode: c.mode,
      testOracle: c.testOracle,
      sandbox: c.sandbox === true,
      epochSeconds: c.epochSeconds || 86400,
      accelerated: c.accelerated === true,
      localIdentity: c.localIdentity || null,
      addresses: c.addresses,
      abis: c.abis,
      demoWallet: c.demoWallet,
      rpcUrl:
        process.env.PUBLIC_RPC_URL ||
        (c.chainId === 31337 ? "http://127.0.0.1:8545" : null),
      explorer: c.chainId === 97 ? "https://testnet.bscscan.com" : null,
    };
  }
  async overview() {
    return this.guard(async () => {
      const [
        totalMinted,
        totalSupply,
        totalBurned,
        cap,
        currentDay,
        nextDay,
        activeDay,
        startDay,
        unallocated,
      ] = await Promise.all([
        this.token.totalMinted(),
        this.token.totalSupply(),
        this.token.totalBurned(),
        this.token.MAX_SUPPLY(),
        this.token.currentDay(),
        this.mining.nextDay(),
        this.mining.activeDay(),
        this.mining.startDay(),
        this.mining.unallocated(),
      ]);
      const [todayEmission, epoch] = await Promise.all([
        this.mining.emission(currentDay),
        activeDay > 0n ? this.mining.epochs(activeDay) : Promise.resolve(null),
      ]);
      let price = null,
        opening = null,
        sellTax = null,
        priceStatus = "unavailable";
      try {
        const q = await this.oracle.quote();
        const b = await this.provider.getBlock("latest");
        if (
          q[0] > 0n &&
          q[1] > 0n &&
          q[3] === currentDay &&
          b &&
          BigInt(b.timestamp) - q[2] <= 3600n
        ) {
          price = q[0];
          opening = q[1];
          sellTax = 500n + (await this.token.crashRate());
          priceStatus = this.config.testOracle ? "test" : "live";
        }
      } catch {}
      return {
        totalMinted,
        totalSupply,
        totalBurned,
        cap,
        currentDay,
        currentEpoch: currentDay,
        epochSeconds: this.config.epochSeconds || 86400,
        accelerated: this.config.accelerated === true,
        nextEpochAt:
          (currentDay + 1n) * BigInt(this.config.epochSeconds || 86400) -
          28800n,
        nextDay,
        activeDay,
        startDay,
        unallocated,
        todayEmission,
        price,
        opening,
        sellTax,
        buyTax: 300,
        priceStatus,
        mode: this.config.mode,
        testOracle: this.config.testOracle,
        settlement: epoch
          ? {
              stage: epoch.stage,
              cursor: epoch.cursor,
              count: epoch.count,
              other: epoch.other,
            }
          : null,
      };
    });
  }
  async market(value?: string) {
    if (!this.config?.sandbox)
      throw new NotFoundException("Sandbox market unavailable");
    const account = value === undefined ? null : address(value);
    return this.guard(async () => {
      const [reserves, currentEpoch, block] = await Promise.all([
        this.pool.reserves(),
        this.token.currentDay(),
        this.provider.getBlock("latest"),
      ]);
      if (!block)
        throw new ServiceUnavailableException("Latest block unavailable");
      const [
        quoteBalance,
        quoteAllowance,
        tokenAllowance,
        nativeBalance,
        nextClaimAt,
      ] = account
        ? await Promise.all([
            this.quote.balanceOf(account),
            this.quote.allowance(account, this.config.addresses.pool),
            this.token.allowance(account, this.config.addresses.pool),
            this.provider.getBalance(account),
            this.faucet.nextClaimAt(account),
          ])
        : [null, null, null, null, null];
      return {
        reserves: { token: reserves[0], quote: reserves[1] },
        quoteBalance,
        allowances: { quote: quoteAllowance, token: tokenAllowance },
        nativeBalance,
        faucet: {
          nextClaimAt,
          available: account !== null && nextClaimAt <= BigInt(block.timestamp),
        },
        currentEpoch,
        nextEpochAt:
          (currentEpoch + 1n) * BigInt(this.config.epochSeconds || 86400) -
          28800n,
      };
    });
  }
  async allAccounts(day: bigint) {
    const [a, b] = await Promise.all([
      this.token.holderCountAt(day),
      this.registry.accountCountAt(day),
    ]);
    // The approved testnet build is validated at 100 accounts; don't exhaust the RPC on unexpected growth.
    if (a + b > 1000n)
      throw new ServiceUnavailableException(
        "Account limit for this testnet query reached; production pagination/indexing required",
      );
    const holders = await Promise.all(
      Array.from({ length: Number(a) }, (_, i) => this.token.holderAt(i)),
    );
    const referrals = await Promise.all(
      Array.from({ length: Number(b) }, (_, i) => this.registry.accountAt(i)),
    );
    return [...new Set<string>([...holders, ...referrals])];
  }
  async ranking(page?: string, limit?: string) {
    const pg = paging(page, limit);
    return this.guard(async () => {
      const day: bigint = await this.token.currentDay();
      const next: bigint = await this.mining.nextDay();
      const start: bigint = await this.mining.startDay();
      const snapshotDay = next > start ? next - 1n : null;
      const accounts = await this.allAccounts(day);
      const entries = await Promise.all(
        accounts.map(async (account) => ({
          address: account,
          balance: (await this.token.balanceOf(account)) as bigint,
          excluded: await this.token.excluded(account),
        })),
      );
      const eligible = entries
        .filter((x) => !x.excluded && x.balance >= 10n ** 18n)
        .sort((a, b) =>
          a.balance < b.balance
            ? -1
            : a.balance > b.balance
              ? 1
              : a.address.localeCompare(b.address),
        );
      let previous = -1n,
        rank = 0;
      const items = eligible.map((x, i) => {
        if (x.balance !== previous) rank = i + 1;
        previous = x.balance;
        return {
          address: x.address,
          balance: x.balance,
          rank,
          zone:
            i < eligible.length / 2
              ? "public"
              : i < eligible.length * 0.8
                ? "optimal"
                : i < eligible.length * 0.95
                  ? "antiMonopoly"
                  : "whale",
        };
      });
      return {
        ...pg,
        total: items.length,
        items: items.slice(pg.skip, pg.skip + pg.limit),
        snapshotDay,
        rankingBasis: "current-balance",
        rewardBasis: "previous-finalized-day",
      };
    });
  }
  async wallet(value: string) {
    const account = address(value);
    return this.guard(async () => {
      const [
        balance,
        currentDay,
        nextDay,
        startDay,
        inviter,
        holding,
        referral,
        hCursor,
        rCursor,
      ] = await Promise.all([
        this.token.balanceOf(account),
        this.token.currentDay(),
        this.mining.nextDay(),
        this.mining.startDay(),
        this.registry.inviter(account),
        this.mining.pending(account, 0, 365),
        this.mining.pending(account, 1, 365),
        this.mining.claimCursor(account, 0),
        this.mining.claimCursor(account, 1),
      ]);
      const snapshotDay = nextDay > startDay ? nextDay - 1n : null;
      const weights =
        snapshotDay === null
          ? [0n, 0n]
          : await Promise.all([
              this.mining.weight(snapshotDay, account, 0),
              this.mining.weight(snapshotDay, account, 1),
            ]);
      const accounts = await this.allAccounts(currentDay);
      const parents = await Promise.all(
        accounts.map((a) => this.registry.inviter(a)),
      );
      const directs = accounts.filter(
        (_, i) => parents[i].toLowerCase() === account.toLowerCase(),
      );
      const referrals = await Promise.all(
        directs.map(async (a) => ({
          address: a,
          balance: await this.token.balanceOf(a),
          boundDay: await this.registry.boundDay(a),
        })),
      );
      const fromH = hCursor === 0n ? startDay : hCursor,
        fromR = rCursor === 0n ? startDay : rCursor;
      return {
        address: account,
        balance,
        inviter,
        holdingPower: weights[0],
        referralPower: weights[1],
        snapshotDay,
        claimable: { holding, referral },
        claimCursor: { holding: fromH, referral: fromR },
        moreClaimDays: {
          holding: fromH + 365n < nextDay,
          referral: fromR + 365n < nextDay,
        },
        canAdvance: { holding: fromH < nextDay, referral: fromR < nextDay },
        referrals,
      };
    });
  }
}
