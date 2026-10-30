import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { root, env, run } from "./process.mjs";
const require = createRequire(path.join(root, "apps/api/package.json"));
const { parse } = require("dotenv");
const settings = {
  ...(fs.existsSync(path.join(root, ".env"))
    ? parse(fs.readFileSync(path.join(root, ".env")))
    : {}),
  ...process.env,
};
if (!/^(0x)?[a-f\d]{64}$/i.test(settings.DEPLOYER_PRIVATE_KEY || "")) {
  console.error(
    "Configure a valid DEPLOYER_PRIVATE_KEY in your local .env. Never send private keys in chat.",
  );
  process.exitCode = 1;
} else {
  Object.assign(env, settings);
  env.DEPLOYER_PRIVATE_KEY =
    "0x" + settings.DEPLOYER_PRIVATE_KEY.replace(/^0x/i, "");
  env.BSC_TESTNET_RPC_URL ||= "https://bsc-testnet-rpc.publicnode.com";
  try {
    await run([
      "--dir",
      "contracts",
      "exec",
      "hardhat",
      "run",
      "scripts/deploy-testnet.ts",
      "--network",
      "bscTestnet",
    ]);
  } catch {
    console.error(
      "BSC testnet deployment failed. Check the preceding safe diagnostic; do not share your .env.",
    );
    process.exitCode = 1;
  }
}
