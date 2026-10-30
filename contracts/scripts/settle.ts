import { ethers, network } from "hardhat";
import fs from "node:fs";
import path from "node:path";
async function main() {
  let localRuntime: any = {};
  try {
    localRuntime = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, "../../.local/dev-urls.json"),
        "utf8",
      ),
    );
  } catch {}
  if (
    network.name === "localhost" &&
    !process.env.RASUN_LOCAL_RPC_URL &&
    !localRuntime.chain
  )
    throw Error(
      "No active local run. Start pnpm dev:local or set RASUN_LOCAL_RPC_URL and DEPLOYMENT_FILE explicitly.",
    );
  const file = path.resolve(
    __dirname,
    "../../",
    process.env.DEPLOYMENT_FILE ||
      (network.name === "bscTestnet"
        ? "deployments/testnet.json"
        : localRuntime.deployment || "deployments/local.json"),
  );
  const c = JSON.parse(fs.readFileSync(file, "utf8"));
  if (Number((await ethers.provider.getNetwork()).chainId) !== c.chainId)
    throw Error("Wrong network");
  if (
    c.localIdentity &&
    (await ethers.provider.getBlock(c.localIdentity.number))?.hash !==
      c.localIdentity.hash
  )
    throw Error(
      "Wrong local RPC instance; use the current local stack configuration",
    );
  const [signer] = await ethers.getSigners();
  const m = new ethers.Contract(c.addresses.mining, c.abis.mining, signer);
  const token = new ethers.Contract(c.addresses.token, c.abis.token, signer);
  const maxDays = Number(process.env.SETTLE_DAYS || 1);
  if (!Number.isInteger(maxDays) || maxDays < 1 || maxDays > 30)
    throw Error("SETTLE_DAYS must be 1..30");
  for (let n = 0; n < maxDays; n++) {
    if (!(await m.activeDay())) {
      if ((await m.nextDay()) >= (await token.currentDay())) break;
      await (await m.beginDay()).wait();
    }
    while (await m.activeDay()) await (await m.process(128)).wait();
    console.log("Settled through day", String((await m.nextDay()) - 1n));
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
