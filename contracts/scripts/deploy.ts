import { ethers, artifacts, network } from "hardhat";
import fs from "node:fs";
import path from "node:path";
async function main() {
  const chain = Number((await ethers.provider.getNetwork()).chainId);
  if (chain !== 31337 && chain !== 97)
    throw Error("Only local chain and BSC testnet deployments are supported");
  const signers = await ethers.getSigners();
  const owner = signers[0];
  const local = chain === 31337;
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
  const deploymentBlock = (await token.deploymentTransaction()!.wait())!
    .blockNumber;
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
    addresses: {
      token: await token.getAddress(),
      registry: await registry.getAddress(),
      mining: await mining.getAddress(),
      oracle: await oracle.getAddress(),
    },
    abis,
    demoWallet: local ? signers[7].address : null,
  };
  const dir = path.resolve(__dirname, "../../deployments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, local ? "local.json" : "testnet.json"),
    JSON.stringify(config, null, 2),
  );
  console.log("Deployed", network.name, JSON.stringify(config.addresses));
  console.log(
    "Configuration saved to deployments/" +
      (local ? "local.json" : "testnet.json"),
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
