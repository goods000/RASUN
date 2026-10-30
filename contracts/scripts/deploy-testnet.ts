import { ethers, artifacts, network } from "hardhat";
import fs from "node:fs";
import path from "node:path";
const { deploymentError } = require("../../scripts/deployment-error.cjs");
let stage = "RPC chain check";
async function main() {
  console.log("Deployment stage: " + stage);
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const fixture =
    process.env.RASUN_TESTNET_FIXTURE === "1" &&
    chainId === 31337 &&
    ["localhost", "hardhat"].includes(network.name);
  if (chainId !== 97 && !fixture)
    throw Error(
      "BSC testnet chain 97 required; local 31337 requires explicit RASUN_TESTNET_FIXTURE=1",
    );
  if (chainId === 97 && !process.env.DEPLOYER_PRIVATE_KEY)
    throw Error(
      "Missing local DEPLOYER_PRIVATE_KEY. Configure it securely on your computer; never send it in chat.",
    );
  const epochSeconds = Number(process.env.RASUN_EPOCH_SECONDS || 300);
  if (![300, 86400].includes(epochSeconds))
    throw Error("RASUN_EPOCH_SECONDS must be 300 or 86400");
  const file = path.resolve(
    __dirname,
    "../../",
    process.env.DEPLOYMENT_FILE || "deployments/testnet.json",
  );
  if (fs.existsSync(file)) {
    const existing = JSON.parse(fs.readFileSync(file, "utf8"));
    if (
      existing.chainId !== chainId ||
      existing.mode !== "testnet" ||
      !existing.sandbox ||
      existing.epochSeconds !== epochSeconds
    )
      throw Error(
        "Existing deployment configuration does not match requested testnet sandbox",
      );
    throw Error(
      "Deployment file already exists; use the existing deployment or select a new DEPLOYMENT_FILE to prevent accidental replacement",
    );
  }
  stage = "deployment wallet and tBNB balance";
  console.log("Deployment stage: " + stage);
  const [owner] = await ethers.getSigners();
  if (!owner) throw Error("No deployment signer configured");
  const ownerAddress = await owner.getAddress();
  console.log("Deployment wallet (public): " + ownerAddress);
  if (
    (await ethers.provider.getBalance(ownerAddress)) < ethers.parseEther("0.02")
  )
    throw Error(
      "Insufficient native tBNB for deployment gas; fund the deployment wallet from a BSC testnet faucet (at least 0.02 tBNB)",
    );
  const names = [
    "MINER_ADDRESS",
    "LIQUIDITY_ADDRESS",
    "TECH_ADDRESS",
    "OPERATIONS_ADDRESS",
    "DAO_ADDRESS",
    "STABILIZATION_ADDRESS",
  ];
  const recipients = names.map((name) => process.env[name] || ownerAddress);
  if (
    recipients.some(
      (address) => !ethers.isAddress(address) || address === ethers.ZeroAddress,
    )
  )
    throw Error("Invalid allocation or treasury address");
  // Seeding requires the initial allocations signer. Never assume control over env-supplied wallets.
  if (
    recipients[0].toLowerCase() !== ownerAddress.toLowerCase() ||
    recipients[1].toLowerCase() !== ownerAddress.toLowerCase()
  )
    throw Error(
      "Sandbox seeding requires MINER_ADDRESS and LIQUIDITY_ADDRESS to equal deployer; external allocations require a separately reviewed signed funding workflow",
    );
  async function deploy(name: string, args: any[] = []): Promise<any> {
    stage = "deploy " + name;
    console.log("Deployment stage: " + stage);
    const contract = await ethers.deployContract(name, args);
    await contract.waitForDeployment();
    await contract.deploymentTransaction()!.wait();
    return contract;
  }
  const token = await deploy("TestnetRASUNToken", [
    ownerAddress,
    ...recipients,
    epochSeconds,
  ]);
  const registry = await deploy("TestnetReferralRegistry", [
    await token.getAddress(),
  ]);
  const oracle = await deploy("TestPriceOracle");
  const quote = await deploy("TestnetQuoteToken");
  const pool = await deploy("TestnetSandboxPool", [
    await token.getAddress(),
    await quote.getAddress(),
    await oracle.getAddress(),
  ]);
  const faucet = await deploy("TestnetFaucet", [
    await token.getAddress(),
    await quote.getAddress(),
  ]);
  const mining = await deploy("MiningRewards", [
    await token.getAddress(),
    await registry.getAddress(),
    await token.currentDay(),
  ]);
  stage = "seed sandbox pool and faucet";
  console.log("Deployment stage: " + stage);
  await (await token.excludeFaucet(faucet)).wait();
  await (await token.transfer(pool, ethers.parseEther("1000000"))).wait();
  await (await quote.mint(pool, ethers.parseEther("500000"))).wait();
  await (await token.transfer(faucet, ethers.parseEther("100000"))).wait();
  await (await quote.transferOwnership(faucet)).wait();
  await (await oracle.transferOwnership(pool)).wait();
  stage = "configure and freeze token";
  console.log("Deployment stage: " + stage);
  await (
    await token.configure(mining, oracle, [await pool.getAddress()])
  ).wait();
  await (await token.freeze()).wait();
  await (await pool.syncOracle()).wait();
  const addresses: Record<string, string> = {};
  const abis: Record<string, any> = {};
  const contracts = { token, registry, mining, oracle, quote, pool, faucet };
  const types: Record<string, string> = {
    token: "TestnetRASUNToken",
    registry: "TestnetReferralRegistry",
    mining: "MiningRewards",
    oracle: "TestPriceOracle",
    quote: "TestnetQuoteToken",
    pool: "TestnetSandboxPool",
    faucet: "TestnetFaucet",
  };
  for (const [key, contract] of Object.entries(contracts)) {
    addresses[key] = await contract.getAddress();
    abis[key] = (await artifacts.readArtifact(types[key])).abi;
    if ((await ethers.provider.getCode(addresses[key])) === "0x")
      throw Error("Missing deployed bytecode: " + key);
  }
  const receipt = (await token.deploymentTransaction()!.wait())!;
  const config = {
    chainId,
    network: fixture ? "BSC-compatible local TEST FIXTURE" : "BSC Testnet",
    mode: "testnet",
    sandbox: true,
    testOracle: true,
    epochSeconds,
    accelerated: epochSeconds !== 86400,
    addresses,
    abis,
    deploymentBlock: receipt.blockNumber,
    localIdentity: fixture
      ? { number: receipt.blockNumber, hash: receipt.blockHash }
      : null,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
  console.log(
    fixture
      ? "Local integration fixture deployed (not public BSC deployment)"
      : "BSC97 sandbox deployment receipts confirmed",
    JSON.stringify(addresses),
  );
  console.log("Configuration: " + file);
}
main().catch((error) => {
  const message = error instanceof Error ? error.message : "";
  const safePrefixes = [
    "BSC testnet chain 97 required",
    "Missing local DEPLOYER_PRIVATE_KEY.",
    "RASUN_EPOCH_SECONDS must be",
    "Existing deployment configuration does not match",
    "Deployment file already exists;",
    "No deployment signer configured",
    "Insufficient native tBNB for deployment gas;",
    "Invalid allocation or treasury address",
    "Sandbox seeding requires",
    "Missing deployed bytecode:",
  ];
  console.error(
    safePrefixes.some((prefix) => message.startsWith(prefix))
      ? message
      : deploymentError(error, stage),
  );
  process.exitCode = 1;
});
