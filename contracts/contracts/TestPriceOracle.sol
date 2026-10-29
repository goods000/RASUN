// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Ownable} from '@openzeppelin/contracts/access/Ownable.sol';
/// @notice TEST ONLY. Owner-supplied quotes are not suitable for real funds.
contract TestPriceOracle is Ownable {
    uint256 public price;uint256 public opening;uint256 public updatedAt;uint256 public openingDay;
    constructor() Ownable(msg.sender) {}
    function setPrices(uint256 price_,uint256 opening_,uint256 day_) external onlyOwner {
        require(block.chainid==31337||block.chainid==97,'TESTNET_ONLY');
        price=price_;opening=opening_;openingDay=day_;updatedAt=block.timestamp;
    }
    function quote() external view returns(uint256,uint256,uint256,uint256){return(price,opening,updatedAt,openingDay);}
}
