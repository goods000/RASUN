import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  ServiceUnavailableException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import { Interface } from "ethers";
import { ChainService } from "./chain.service";
import { paging, address, databaseUrl } from "./config";
@Injectable()
export class IndexerService implements OnModuleInit, OnModuleDestroy {
  db = new PrismaClient({
    adapter: new PrismaLibSQL({
      url: databaseUrl(),
    }),
  });
  timer?: ReturnType<typeof setInterval>;
  busy = false;
  error: string | null = null;
  lastBlock: number | null = null;
  constructor(private chain: ChainService) {}
  get scope() {
    return `${this.chain.config?.chainId}:${this.chain.config?.addresses.token.toLowerCase()}`;
  }
  async onModuleInit() {
    await this.db.$connect();
    await this.sync();
    this.timer = setInterval(() => void this.sync(), 1000);
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.db.$disconnect();
    this.chain.provider.destroy();
  }
  async sync() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.chain.ready();
      const c = this.chain.config,
        scope = this.scope;
      const confirmation = Number(
        process.env.CONFIRMATIONS ?? (c.chainId === 31337 ? "0" : "12"),
      );
      if (!Number.isInteger(confirmation) || confirmation < 0)
        throw Error("Invalid confirmations");
      const tip = await this.chain.provider.getBlockNumber();
      const target = Math.max(-1, tip - confirmation);
      let last = await this.db.indexedBlock.findFirst({
        where: { scope },
        orderBy: { number: "desc" },
      });
      while (last) {
        const remote = await this.chain.provider.getBlock(last.number);
        if (remote?.hash === last.hash && last.number <= target) break;
        await this.db.$transaction([
          this.db.chainEvent.deleteMany({
            where: { scope, blockNumber: { gte: last.number } },
          }),
          this.db.indexedBlock.deleteMany({
            where: { scope, number: { gte: last.number } },
          }),
        ]);
        last = await this.db.indexedBlock.findFirst({
          where: { scope },
          orderBy: { number: "desc" },
        });
      }
      const from = last ? last.number + 1 : c.deploymentBlock;
      const to = Math.min(target, from + 199);
      const interfaces = Object.fromEntries(
        Object.entries(c.addresses).map(([name, addr]) => [
          String(addr).toLowerCase(),
          new Interface(c.abis[name]),
        ]),
      );
      if (from <= to) {
        const logs = await this.chain.provider.getLogs({
          address: Object.values(c.addresses) as string[],
          fromBlock: from,
          toBlock: to,
        });
        for (let n = from; n <= to; n++) {
          const block = await this.chain.provider.getBlock(n);
          if (!block?.hash) throw Error("Missing block");
          const events: Prisma.ChainEventCreateInput[] = [];
          for (const log of logs.filter((l) => l.blockNumber === n)) {
            if (log.blockHash !== block.hash)
              throw Error("Reorg while indexing");
            const parsed = interfaces[log.address.toLowerCase()]?.parseLog(log);
            if (!parsed) continue;
            const args: any = {};
            parsed.fragment.inputs.forEach(
              (input, i) =>
                (args[input.name || String(i)] =
                  typeof parsed.args[i] === "bigint"
                    ? String(parsed.args[i])
                    : parsed.args[i]),
            );
            const accounts = Object.values(args).filter(
              (v): v is string =>
                typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v),
            );
            events.push({
              scope,
              txHash: log.transactionHash,
              logIndex: log.index,
              blockNumber: n,
              blockHash: block.hash,
              contractAddress: log.address.toLowerCase(),
              name: parsed.name,
              args: JSON.stringify(args),
              account1: accounts[0]?.toLowerCase(),
              account2: accounts[1]?.toLowerCase(),
              timestamp: block.timestamp,
            });
          }
          // Verify after log collection as well; replay on a moving fork instead of mixing branches.
          if ((await this.chain.provider.getBlock(n))?.hash !== block.hash)
            throw Error("Reorg while indexing");
          await this.db.$transaction(async (tx) => {
            for (const event of events)
              await tx.chainEvent.upsert({
                where: {
                  scope_txHash_logIndex: {
                    scope,
                    txHash: event.txHash,
                    logIndex: event.logIndex,
                  },
                },
                create: event,
                update: event,
              });
            await tx.indexedBlock.upsert({
              where: { scope_number: { scope, number: n } },
              create: { scope, number: n, hash: block.hash! },
              update: { hash: block.hash! },
            });
          });
        }
      }
      const row = await this.db.indexedBlock.findFirst({
        where: { scope },
        orderBy: { number: "desc" },
      });
      this.lastBlock = row?.number ?? null;
      this.error = null;
    } catch {
      this.error =
        "Chain index unavailable; check RPC, deployment and database";
    } finally {
      this.busy = false;
    }
  }
  async events(page?: string, limit?: string, wallet?: string, event?: string) {
    if (
      event &&
      ![
        "Claimed",
        "Transfer",
        "Bound",
        "TaxPaid",
        "DayStarted",
        "DayFinalized",
      ].includes(event)
    )
      throw new BadRequestException("Invalid event filter");
    const pg = paging(page, limit);
    const who = wallet ? address(wallet).toLowerCase() : null;
    await this.chain.ready();
    if (this.error) throw new ServiceUnavailableException(this.error);
    const where = {
      scope: this.scope,
      ...(event ? { name: event } : {}),
      ...(who ? { OR: [{ account1: who }, { account2: who }] } : {}),
    };
    const [total, items] = await Promise.all([
      this.db.chainEvent.count({ where }),
      this.db.chainEvent.findMany({
        where,
        skip: pg.skip,
        take: pg.limit,
        orderBy: [{ blockNumber: "desc" }, { logIndex: "desc" }],
      }),
    ]);
    return {
      total,
      page: pg.page,
      limit: pg.limit,
      items: items.map((x) => ({ ...x, args: JSON.parse(x.args) })),
      lastBlock: this.lastBlock,
    };
  }
}
