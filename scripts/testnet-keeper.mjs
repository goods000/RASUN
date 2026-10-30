import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { root } from "./process.mjs";
import { validateTestnet, keeperStep, PUBLIC_RPC } from "./testnet-runtime.mjs";
const require = createRequire(path.join(root, "apps/api/package.json"));
const { JsonRpcProvider, Wallet, Contract } = require("ethers");
const { parse } = require("dotenv");
const settings = {
  ...(fs.existsSync(path.join(root, ".env"))
    ? parse(fs.readFileSync(path.join(root, ".env")))
    : {}),
  ...process.env,
};
let provider,
  closing = false;
process.on("SIGINT", () => {
  closing = true;
});
process.on("SIGTERM", () => {
  closing = true;
});
try {
  const config = JSON.parse(
    fs.readFileSync(
      path.resolve(
        root,
        settings.DEPLOYMENT_FILE || "deployments/testnet.json",
      ),
      "utf8",
    ),
  );
  provider = new JsonRpcProvider(
    settings.BSC_TESTNET_RPC_URL || PUBLIC_RPC,
    undefined,
    { cacheTimeout: -1 },
  );
  await validateTestnet(config, provider, settings.TESTNET_FIXTURE === "1");
  if (!settings.DEPLOYER_PRIVATE_KEY)
    throw Error("Local DEPLOYER_PRIVATE_KEY required");
  const signer = new Wallet(settings.DEPLOYER_PRIVATE_KEY, provider);
  delete settings.DEPLOYER_PRIVATE_KEY;
  const make = (n) => new Contract(config.addresses[n], config.abis[n], signer);
  const context = {
    provider,
    signer,
    token: make("token"),
    mining: make("mining"),
    pool: make("pool"),
  };
  console.log(
    `Permissionless keeper on ${config.chainId === 97 ? "BSC TESTNET 97" : "LOCAL HARDHAT FIXTURE (not public BSC)"}; bounded batch 128; signer ${signer.address}`,
  );
  while (!closing) {
    try {
      await validateTestnet(config, provider, settings.TESTNET_FIXTURE === "1");
      const result = await keeperStep(context);
      console.log(new Date().toISOString() + " keeper " + result);
    } catch {
      console.error(
        new Date().toISOString() +
          " keeper tick failed; check gas balance, RPC and settlement state (retrying)",
      );
    }
    if (!closing) await new Promise((resolve) => setTimeout(resolve, 10000));
  }
} catch {
  console.error(
    "Keeper startup failed; verify local key, funded native gas, RPC chain and deployed contracts.",
  );
  process.exitCode = 1;
} finally {
  provider?.destroy();
}
