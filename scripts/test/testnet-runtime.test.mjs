import test from "node:test";
import assert from "node:assert/strict";
import {
  validateTestnet,
  testnetRuntime,
  keeperStep,
  gasBudget,
} from "../testnet-runtime.mjs";
const names = [
  "token",
  "registry",
  "mining",
  "oracle",
  "quote",
  "pool",
  "faucet",
];
const config = {
  mode: "testnet",
  chainId: 97,
  sandbox: true,
  epochSeconds: 300,
  accelerated: true,
  localIdentity: null,
  deploymentBlock: 2,
  addresses: Object.fromEntries(
    names.map((n, i) => [n, "0x" + String(i + 1).padStart(40, "0")]),
  ),
  abis: Object.fromEntries(names.map((n) => [n, []])),
};
const provider = {
  getNetwork: async () => ({ chainId: 97n }),
  getCode: async () => "0x1234",
  call: async () => "0x12c",
};
test("validates every deployment contract and rejects unsupported chains", async () => {
  await validateTestnet(config, provider);
  await assert.rejects(
    validateTestnet({ ...config, chainId: 56 }, provider),
    /chain|97/i,
  );
  await assert.rejects(
    validateTestnet(config, { ...provider, getCode: async () => "0x" }),
    /code/i,
  );
  await assert.rejects(
    validateTestnet({ ...config, accelerated: false }, provider),
    /metadata/i,
  );
});
test("fixture needs explicit opt in and verified hardhat metadata", async () => {
  const c = { ...config, chainId: 31337 };
  const p = {
    ...provider,
    getNetwork: async () => ({ chainId: 31337n }),
    send: async () => ({ chainId: 31337, instanceId: "abc" }),
  };
  await assert.rejects(validateTestnet(c, p), /fixture/i);
  await validateTestnet(c, p, true);
  await assert.rejects(
    validateTestnet(c, { ...p, send: async () => ({}) }, true),
    /metadata/i,
  );
});
test("runtime isolates persistent index and private/public RPC", () => {
  const a = testnetRuntime(
    "/repo",
    "run",
    { api: 3001, dapp: 5175, admin: 5176 },
    config,
    { BSC_TESTNET_RPC_URL: "https://private.invalid/key" },
  );
  assert.equal(a.environment.RPC_URL, "https://private.invalid/key");
  assert.equal(
    a.environment.PUBLIC_RPC_URL,
    "https://bsc-testnet-rpc.publicnode.com",
  );
  assert.match(a.environment.DEPLOYMENT_FILE, /deployments\/testnet.json$/);
  assert.match(a.environment.DATABASE_URL, /0x0+1/);
  const fixture = { ...config, chainId: 31337 };
  const ports = { api: 3001, dapp: 5175, admin: 5176 };
  assert.notEqual(
    testnetRuntime("/repo", "one", ports, fixture).urls.database,
    testnetRuntime("/repo", "two", ports, fixture).urls.database,
  );
  assert.equal(
    testnetRuntime("/repo", "one", ports, config).urls.database,
    testnetRuntime("/repo", "two", ports, config).urls.database,
  );
});
test("keeper idle performs no writes and bounds work and gas budget", async () => {
  let writes = 0;
  const mining = {
    activeDay: async () => 0n,
    nextDay: async () => 10n,
    beginDay: async () => {
      writes++;
    },
    process: async () => {
      writes++;
    },
  };
  assert.equal(
    await keeperStep({
      mining,
      token: { currentDay: async () => 10n },
      pool: {
        syncOracle: async () => {
          writes++;
        },
      },
      provider: { getBalance: async () => 0n },
      signer: { address: "x" },
    }),
    "idle",
  );
  assert.equal(writes, 0);
  assert.equal(gasBudget(2n, 100n), 240n);
  await assert.rejects(
    keeperStep({
      mining: { ...mining, nextDay: async () => 9n },
      token: { currentDay: async () => 10n },
      provider: {
        getBalance: async () => 0n,
        getFeeData: async () => ({ gasPrice: 1n }),
      },
      signer: { address: "x" },
    }),
    /gas/i,
  );
});
test("keeper resumes active epochs, awaits bounded process and oracle receipts", async () => {
  const calls = [];
  const tx = (n) => {
    const method = async (...args) => {
      calls.push([n, ...args]);
      return { wait: async () => calls.push(["receipt", n]) };
    };
    method.estimateGas = async () => 4000000n;
    return method;
  };
  const result = await keeperStep({
    mining: {
      activeDay: async () => 9n,
      nextDay: async () => 9n,
      process: tx("process"),
      beginDay: tx("begin"),
    },
    token: { currentDay: async () => 10n },
    pool: { syncOracle: tx("oracle") },
    provider: {
      getBalance: async () => 100000000n,
      getFeeData: async () => ({ gasPrice: 1n }),
    },
    signer: { address: "x" },
  });
  assert.equal(result, "processed");
  assert.deepEqual(calls, [
    ["process", 128, { gasLimit: 4800000n, gasPrice: 1n }],
    ["receipt", "process"],
    ["oracle", { gasLimit: 300000n, gasPrice: 1n }],
    ["receipt", "oracle"],
  ]);
  await assert.rejects(keeperStep({ batch: 129 }), /batch/);
});
test("keeper reduces a 100-holder batch when 128 operations exceed the gas cap", async () => {
  let sent;
  const process = async (batch, options) => {
    sent = { batch, options };
    return { wait: async () => {} };
  };
  process.estimateGas = async (batch) => (batch === 128 ? 5860072n : 2930036n);
  await keeperStep({
    mining: { activeDay: async () => 9n, nextDay: async () => 9n, process },
    token: { currentDay: async () => 10n },
    pool: { syncOracle: async () => ({ wait: async () => {} }) },
    provider: {
      getBalance: async () => 100000000n,
      getFeeData: async () => ({ gasPrice: 1n }),
    },
    signer: { address: "x" },
  });
  assert.equal(sent.batch, 64);
  assert.equal(sent.options.gasLimit, 3516043n);
  assert.ok(sent.options.gasLimit <= 5000000n);
});
