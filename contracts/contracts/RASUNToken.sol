// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
/// @notice TEST SCAFFOLD ONLY. No token taxes, emissions, mining or oracle yet.
contract RASUNToken is ERC20, Ownable {
    uint256 public constant MAX_SUPPLY = 100_000_000 ether;
    constructor(address initialOwner) ERC20("RASUN", "RASUN") Ownable(initialOwner) {
        _mint(initialOwner, 2_000_000 ether);
    }
    function mint(address to, uint256 amount) external onlyOwner {
        require(totalSupply() + amount <= MAX_SUPPLY, "CAP_EXCEEDED");
        _mint(to, amount);
    }
}
