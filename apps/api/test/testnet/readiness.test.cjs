require("reflect-metadata");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ApiController } = require("../../dist/app.module");
const { IndexerService } = require("../../dist/indexer.service");
test("HTTP liveness remains reachable while chain health is waiting on slow RPC", async () => {
  const { Module } = require("@nestjs/common");
  const { NestFactory } = require("@nestjs/core");
  const { ChainService } = require("../../dist/chain.service");
  let entered;
  const waiting = new Promise((r) => {
    entered = r;
  });
  let release;
  const delay = new Promise((r) => {
    release = r;
  });
  class SlowRpcModule {}
  Module({
    controllers: [ApiController],
    providers: [
      {
        provide: ChainService,
        useValue: {
          config: { chainId: 97, addresses: { token: "0xtoken" } },
          ready: async () => {
            entered();
            await delay;
          },
        },
      },
      {
        provide: IndexerService,
        useValue: { busy: true, lastBlock: 12, error: null },
      },
    ],
  })(SlowRpcModule);
  const app = await NestFactory.create(SlowRpcModule, { logger: false });
  app.setGlobalPrefix("api");
  let pending;
  try {
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();
    pending = fetch(base + "/api/health");
    await waiting;
    const response = await fetch(base + "/api/live", {
      signal: AbortSignal.timeout(1000),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).indexStatus, "syncing");
  } finally {
    release();
    await pending;
    await app.close();
  }
});
test("API liveness is independent of public RPC and reports instance and index status", () => {
  const api = new ApiController(
    {
      config: { chainId: 97, addresses: { token: "0xtoken" } },
      ready: () => {
        throw Error("Must not query RPC for liveness");
      },
    },
    { busy: true, lastBlock: 12, error: null },
  );
  const result = api.live();
  assert.equal(result.ok, true);
  assert.equal(result.chainId, 97);
  assert.equal(result.token, "0xtoken");
  assert.equal(result.indexStatus, "syncing");
});
test("slow initial indexing does not block API module initialization", async () => {
  let resolveSync;
  const service = {
    db: { $connect: async () => {} },
    sync: () =>
      new Promise((r) => {
        resolveSync = r;
      }),
  };
  let timer;
  try {
    const result = await Promise.race([
      IndexerService.prototype.onModuleInit.call(service).then(() => "ready"),
      new Promise((r) => {
        timer = setTimeout(() => r("blocked"), 100);
      }),
    ]);
    assert.equal(result, "ready");
  } finally {
    clearTimeout(timer);
    resolveSync?.();
    await new Promise(setImmediate);
    clearInterval(service.timer);
  }
});
