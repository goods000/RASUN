import path from "node:path";
import { createRequire } from "node:module";
const { id } = createRequire(
  new URL("../apps/api/package.json", import.meta.url),
)("ethers");
export const PUBLIC_RPC = "https://bsc-testnet-rpc.publicnode.com";
export async function validateTestnet(c, provider, fixture = false) {
  if (c.mode !== "testnet" || !c.sandbox || ![97, 31337].includes(c.chainId))
    throw Error("Sandbox chain must be 97");
  if (
    !Number.isSafeInteger(c.epochSeconds) ||
    c.epochSeconds < 1 ||
    c.accelerated !== (c.epochSeconds !== 86400) ||
    !Number.isSafeInteger(c.deploymentBlock) ||
    c.deploymentBlock < 0
  )
    throw Error("Invalid deployment metadata");
  if (Number((await provider.getNetwork()).chainId) !== c.chainId)
    throw Error("RPC chain mismatch");
  if (c.chainId === 31337) {
    if (!fixture) throw Error("Local fixture requires TESTNET_FIXTURE=1");
    const m = await provider.send("hardhat_metadata", []);
    if (Number(m.chainId) !== 31337 || !m.instanceId)
      throw Error("Invalid Hardhat fixture metadata");
  } else if (c.localIdentity)
    throw Error("Public chain metadata cannot have local identity");
  for (const n of [
    "token",
    "registry",
    "mining",
    "oracle",
    "quote",
    "pool",
    "faucet",
  ]) {
    if (
      !/^0x[\da-f]{40}$/i.test(c.addresses?.[n] || "") ||
      !Array.isArray(c.abis?.[n])
    )
      throw Error("Invalid contract metadata: " + n);
    if (!/^0x[\da-f]+$/i.test(await provider.getCode(c.addresses[n])))
      throw Error("Missing contract code: " + n);
  }
  const clock = await provider.call({
    to: c.addresses.token,
    data: id("epochSeconds()").slice(0, 10),
  });
  if (BigInt(clock) !== BigInt(c.epochSeconds))
    throw Error("On-chain epoch metadata mismatch");
}
export function testnetRuntime(root, runId, ports, c, settings = {}) {
  const dir = path.join(
    root,
    ".local/testnet",
    String(c.chainId),
    c.addresses.token.toLowerCase(),
  );
  const urls = {
    runId,
    dapp: `http://localhost:${ports.dapp}`,
    admin: `http://localhost:${ports.admin}`,
    api: `http://127.0.0.1:${ports.api}`,
    deployment: path.resolve(
      root,
      settings.DEPLOYMENT_FILE || "deployments/testnet.json",
    ),
    database:
      "file:" +
      path.join(dir, c.chainId === 31337 ? `fixture-${runId}.db` : "index.db"),
    logs: path.join(dir, "runs", runId),
  };
  return {
    urls,
    environment: {
      RASUN_DEV_RUN_ID: runId,
      RPC_URL: settings.BSC_TESTNET_RPC_URL || PUBLIC_RPC,
      PUBLIC_RPC_URL:
        settings.PUBLIC_RPC_URL ||
        (c.chainId === 97 ? PUBLIC_RPC : settings.BSC_TESTNET_RPC_URL),
      DEPLOYMENT_FILE: urls.deployment,
      DATABASE_URL: urls.database,
      PORT: String(ports.api),
      CONFIRMATIONS: c.chainId === 97 ? "12" : "0",
      RASUN_API_URL: urls.api,
      RASUN_DAPP_PORT: String(ports.dapp),
      RASUN_ADMIN_PORT: String(ports.admin),
      RASUN_UI_STRICT_PORT: "1",
      CORS_ORIGINS: `${urls.dapp},http://127.0.0.1:${ports.dapp},${urls.admin},http://127.0.0.1:${ports.admin}`,
    },
  };
}
export function gasBudget(price, limit) {
  return (price * limit * 120n) / 100n;
}
export async function keeperStep({
  mining,
  token,
  pool,
  provider,
  signer,
  batch = 128,
}) {
  if (!Number.isInteger(batch) || batch < 1 || batch > 128)
    throw Error("Keeper batch must be 1..128");
  const [active, next, current] = await Promise.all([
    mining.activeDay(),
    mining.nextDay(),
    token.currentDay(),
  ]);
  if (active === 0n && next >= current) return "idle";
  const fees = await provider.getFeeData();
  const price = fees.maxFeePerGas ?? fees.gasPrice;
  if (!price) throw Error("Gas price unavailable");
  // Bound total per-tick spending, including oracle, begin and process receipts.
  if ((await provider.getBalance(signer.address)) < gasBudget(price, 6000000n))
    throw Error("Insufficient native gas balance for keeper budget");
  if (active === 0n)
    await (
      await mining.beginDay({ gasLimit: 500000n, gasPrice: price })
    ).wait();
  let operations = batch,
    processGas;
  while (operations >= 1) {
    try {
      const estimate = await mining.process.estimateGas(operations);
      const buffered = gasBudget(1n, estimate);
      if (buffered <= 5000000n) {
        processGas = buffered;
        break;
      }
    } catch {}
    operations = Math.floor(operations / 2);
  }
  if (!processGas)
    throw Error("Keeper process exceeds gas budget even at batch one");
  await (
    await mining.process(operations, { gasLimit: processGas, gasPrice: price })
  ).wait();
  await (await pool.syncOracle({ gasLimit: 300000n, gasPrice: price })).wait();
  return "processed";
}
