import { ethers } from "hardhat";
async function main() { const [deployer] = await ethers.getSigners(); const token = await ethers.deployContract("RASUNToken", [deployer.address]); await token.waitForDeployment(); console.log("RASUNToken:", await token.getAddress()); }
main().catch((e) => { console.error(e); process.exitCode = 1; });
