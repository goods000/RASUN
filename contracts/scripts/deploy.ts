import { ethers, artifacts, network } from "hardhat";
import fs from "node:fs";
import path from "node:path";
async function main() {
  let active: any = {};
  try {
    active = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, "../../.local/dev-urls.json"),
        "utf8",
      ),
    );
  } catch {}
  const bootstrap =
    process.env.RASUN_BOOTSTRAP_DEPLOY &&
    process.env.RASUN_BOOTSTRAP_DEPLOY === process.env.RASUN_DEV_RUN_ID;
  if (network.name === "localhost" && !bootstrap) {
    if (!process.env.RASUN_LOCAL_RPC_URL || !process.env.DEPLOYMENT_FILE)
      throw Error(
        "Use pnpm dev:local for a fresh stack. Manual deployment requires explicit RASUN_LOCAL_RPC_URL and DEPLOYMENT_FILE.",
      );
    if (active.chain === process.env.RASUN_LOCAL_RPC_URL)
      throw Error(
        "Do not redeploy into an active managed stack; restart with pnpm dev:local.",
      );
  }
  const chain = Number((await ethers.provider.getNetwork()).chainId);
  if (chain !== 31337 && chain !== 97)
    throw Error("Only local chain and BSC testnet deployments are supported");
  const local = chain === 31337;
  const file = path.resolve(
    __dirname,
    "../../",
    process.env.DEPLOYMENT_FILE ||
      (local ? "deployments/local.json" : "deployments/testnet.json"),
  );
  if (
    fs.existsSync(file) &&
    JSON.parse(fs.readFileSync(file, "utf8")).chainId !== chain
  )
    throw Error("Refusing to overwrite a deployment for another network");
  const signers = await ethers.getSigners();
  const owner = signers[0];
  const names = [
    "MINER_ADDRESS",
    "LIQUIDITY_ADDRESS",
    "TECH_ADDRESS",
    "OPERATIONS_ADDRESS",
    "DAO_ADDRESS",
    "STABILIZATION_ADDRESS",
  ];
  const recipients = names.map((name, i) =>
    local ? signers[i + 1].address : process.env[name],
  );
  if (recipients.some((x) => !x || !ethers.isAddress(x)))
    throw Error(
      "Set all allocation/treasury addresses before testnet deployment",
    );
  if (local)
    await ethers.provider.send("hardhat_setCoinbase", [
      ethers.hexlify(ethers.randomBytes(20)),
    ]);
  const token: any = await ethers.deployContract("RASUNToken", [
    owner.address,
    ...recipients,
  ]);
  await token.waitForDeployment();
  const registry: any = await ethers.deployContract("ReferralRegistry");
  await registry.waitForDeployment();
  const oracle: any = await ethers.deployContract("TestPriceOracle");
  await oracle.waitForDeployment();
  const day = await token.currentDay();
  const mining: any = await ethers.deployContract("MiningRewards", [
    token,
    registry,
    day,
  ]);
  await mining.waitForDeployment();
  const pools = local
    ? [signers[9].address]
    : (process.env.POOL_ADDRESSES || "").split(",").filter(Boolean);
  if (!local && pools.length)
    throw Error(
      "Test oracle deployment cannot enable real trading pools; configure a vetted oracle in a separate reviewed deployment",
    );
  await (await token.configure(mining, oracle, pools)).wait();
  await (await token.freeze()).wait();
  const deploymentReceipt = (await token.deploymentTransaction()!.wait())!;
  const deploymentBlock = deploymentReceipt.blockNumber;
  if (local) {
    for (const [i, amount] of [
      [7, "100"],
      [8, "100"],
      [10, "101"],
      [11, "0.5"],
    ] as const)
      await (
        await token
          .connect(signers[1])
          .transfer(signers[i], ethers.parseEther(amount))
      ).wait();
    await (await registry.connect(signers[8]).bind(signers[7])).wait();
    await (await registry.connect(signers[10]).bind(signers[7])).wait();
    await ethers.provider.send("evm_setNextBlockTimestamp", [
      Number((day + 1n) * 86400n - 28800n),
    ]);
    await ethers.provider.send("evm_mine", []);
    await (await mining.beginDay()).wait();
    while (await mining.activeDay()) await (await mining.process(128)).wait();
    await (
      await oracle.setPrices(
        ethers.parseEther("0.5"),
        ethers.parseEther("0.5"),
        await token.currentDay(),
      )
    ).wait();
  }
  const abis: any = {};
  for (const [name, artifact] of Object.entries({
    token: "RASUNToken",
    registry: "ReferralRegistry",
    mining: "MiningRewards",
    oracle: "TestPriceOracle",
  }))
    abis[name] = (await artifacts.readArtifact(artifact)).abi;
  const config = {
    chainId: chain,
    network: local ? "Hardhat Local" : "BSC Testnet",
    testOracle: true,
    mode: local ? "local" : "testnet",
    deploymentBlock,
    localIdentity: local
      ? { number: deploymentBlock, hash: deploymentReceipt.blockHash }
      : null,
    addresses: {
      token: await token.getAddress(),
      registry: await registry.getAddress(),
      mining: await mining.getAddress(),
      oracle: await oracle.getAddress(),
    },
    abis,
    demoWallet: local ? signers[7].address : null,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
  console.log("Deployed", network.name, JSON.stringify(config.addresses));
  console.log("Configuration saved to " + file);
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
