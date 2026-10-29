import { expect } from "chai";
import { ethers } from "hardhat";
describe("RASUNToken scaffold", () => {
  it("mints initial 2 million and enforces cap", async () => {
    const [owner, other] = await ethers.getSigners();
    const token = await ethers.deployContract("RASUNToken", [owner.address]);
    await token.waitForDeployment();
    expect(await token.totalSupply()).to.equal(ethers.parseEther("2000000"));
    await expect(token.connect(other).mint(other.address, 1n)).to.be.reverted;
    await expect(token.mint(owner.address, ethers.parseEther("98000001"))).to.be.revertedWith("CAP_EXCEEDED");
  });
});
