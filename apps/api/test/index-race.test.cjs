const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createClient } = require("@libsql/client");
const { Interface } = require("ethers");
const token = "0x1111111111111111111111111111111111111111";
const A = "0x" + "aa".repeat(32),
  B = "0x" + "bb".repeat(32),
  B2 = "0x" + "cc".repeat(32),
  TXA = "0x" + "11".repeat(32),
  TXB = "0x" + "22".repeat(32);
const abi = [
  "event Transfer(address indexed from,address indexed to,uint256 value)",
];
function log(hash = B) {
  const encoded = new Interface(abi).encodeEventLog("Transfer", [
    token,
    "0x2222222222222222222222222222222222222222",
    123n,
  ]);
  return {
    address: token,
    blockNumber: 1,
    blockHash: hash,
    transactionHash: TXB,
    index: 0,
    ...encoded,
  };
}
async function withIndex(provider, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rasun-index-race-"));
  const url = "file:" + path.join(dir, "test.db");
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = url;
  const sqlite = createClient({ url });
  await sqlite.executeMultiple(
    fs.readFileSync(
      path.join(__dirname, "../prisma/migrations/001-index.sql"),
      "utf8",
    ),
  );
  sqlite.close();
  const { IndexerService } = require("../dist/indexer.service.js");
  const index = new IndexerService({
    config: {
      chainId: 31337,
      addresses: { token },
      abis: { token: abi },
      deploymentBlock: 1,
    },
    ready: async () => {},
    provider,
  });
  try {
    await body(index);
  } finally {
    await index.db.$disconnect();
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
test("does not pair new block headers with empty logs read from an orphaned fork", async () => {
  let fork = "A";
  const provider = {
    getBlockNumber: async () => 1,
    getBlock: async () => ({
      hash: fork === "A" ? A : B,
      parentHash: "0x" + "00".repeat(32),
      timestamp: 1,
    }),
    getLogs: async (filter) => {
      if (fork === "A") {
        fork = "B";
        return [];
      }
      return filter.blockHash === B ? [log()] : [];
    },
  };
  await withIndex(provider, async (index) => {
    await index.sync();
    await index.sync();
    assert.equal(
      await index.db.chainEvent.count(),
      1,
      "replacement event must not disappear behind a matching stored header",
    );
  });
});
test("rejects a new block whose parent differs from the previously validated cursor", async () => {
  let fork = "A";
  const provider = {
    getBlockNumber: async () => 2,
    getBlock: async (n) => {
      if (n === 2) {
        fork = "B";
        return { hash: B2, parentHash: B, timestamp: 2 };
      }
      return {
        hash: fork === "A" ? A : B,
        parentHash: "0x" + "00".repeat(32),
        timestamp: 1,
      };
    },
    getLogs: async (filter) => {
      fork = "B";
      return filter.blockHash === B ? [log()] : [];
    },
  };
  await withIndex(provider, async (index) => {
    const scope = index.scope;
    await index.db.indexedBlock.create({ data: { scope, number: 1, hash: A } });
    await index.db.chainEvent.create({
      data: {
        scope,
        txHash: TXA,
        logIndex: 0,
        blockNumber: 1,
        blockHash: A,
        contractAddress: token,
        name: "Transfer",
        args: "{}",
        timestamp: 1,
      },
    });
    await index.sync();
    await index.sync();
    assert.equal(
      await index.db.chainEvent.count({ where: { txHash: TXA } }),
      0,
      "orphan from previous cursor must be rolled back",
    );
    assert.equal(
      await index.db.chainEvent.count({ where: { txHash: TXB } }),
      1,
    );
  });
});
