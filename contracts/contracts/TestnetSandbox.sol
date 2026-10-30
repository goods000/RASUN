// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {RASUNToken} from './RASUNToken.sol';
import {ReferralRegistry} from './ReferralRegistry.sol';
import {TestPriceOracle} from './TestPriceOracle.sol';
import {ERC20} from '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import {Ownable} from '@openzeppelin/contracts/access/Ownable.sol';
import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import {ReentrancyGuard} from '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
abstract contract TestnetOnly {
    constructor(){require(block.chainid==97||block.chainid==31337,'TESTNET_ONLY');}
}
/// @notice TESTNET ONLY accelerated epochs; never use for production daily accounting.
contract TestnetRASUNToken is RASUNToken, TestnetOnly {
    uint256 public immutable epochSeconds;
    constructor(address admin,address miner,address liquidity,address tech,address ops,address dao_,address stabilization_,uint256 epoch_)
        RASUNToken(admin,miner,liquidity,tech,ops,dao_,stabilization_) {
        require(epoch_==300||epoch_==86400,'INVALID_EPOCH');epochSeconds=epoch_;
    }
    /// @notice Exclude faucet escrow from mining snapshots before seeding; it is not a trading pool.
    function excludeFaucet(address faucet) external onlyOwner {
        require(!frozen,'LOCKED');require(faucet.code.length>0,'CONTRACT_REQUIRED');excluded[faucet]=true;
    }
    // Base constructor calls this before the immutable is assigned.
    function currentDay() public view override returns(uint256){uint256 epoch=epochSeconds;return (block.timestamp+8 hours)/(epoch==0?86400:epoch);}
}
contract TestnetReferralRegistry is ReferralRegistry, TestnetOnly {
    TestnetRASUNToken public immutable token;
    constructor(TestnetRASUNToken token_){require(address(token_).code.length>0,'CONTRACT_REQUIRED');token=token_;}
    function _currentDay() internal view override returns(uint256){return token.currentDay();}
}
/// @notice Worthless sandbox tUSDT. Not USDT and not redeemable.
contract TestnetQuoteToken is ERC20, Ownable, TestnetOnly {
    constructor() ERC20('Sandbox Test USDT (no value)','tUSDT') Ownable(msg.sender) {}
    function mint(address to,uint256 amount) external onlyOwner {_mint(to,amount);}
}
contract TestnetFaucet is ReentrancyGuard, TestnetOnly {
    using SafeERC20 for IERC20;
    IERC20 public immutable token;TestnetQuoteToken public immutable quote;
    mapping(address=>uint256) public nextClaimAt;
    event FaucetClaimed(address indexed account,uint256 tokenAmount,uint256 quoteAmount);
    constructor(IERC20 token_,TestnetQuoteToken quote_){token=token_;quote=quote_;}
    function claim() external nonReentrant {
        require(block.timestamp>=nextClaimAt[msg.sender],'COOLDOWN');nextClaimAt[msg.sender]=block.timestamp+1 days;
        token.safeTransfer(msg.sender,100 ether);quote.mint(msg.sender,1000 ether);
        emit FaucetClaimed(msg.sender,100 ether,1000 ether);
    }
}
/// @notice TESTNET ONLY constant product sandbox, no real assets. Oracle is manipulable simulation, not a production price feed.
contract TestnetSandboxPool is ReentrancyGuard, TestnetOnly {
    using SafeERC20 for IERC20;
    TestnetRASUNToken public immutable token;IERC20 public immutable quote;TestPriceOracle public immutable oracle;
    event Swap(address indexed account,bool buy,uint256 amountIn,uint256 amountOut);
    constructor(TestnetRASUNToken token_,IERC20 quote_,TestPriceOracle oracle_){token=token_;quote=quote_;oracle=oracle_;}
    function reserves() public view returns(uint256 tokenReserve,uint256 quoteReserve){return(token.balanceOf(address(this)),quote.balanceOf(address(this)));}
    function quoteBuy(uint256 quoteIn) public view returns(uint256){(uint256 t,uint256 q)=reserves();return q==0?0:t*quoteIn/(q+quoteIn);}
    function quoteSell(uint256 tokenIn) public view returns(uint256){(uint256 t,uint256 q)=reserves();uint256 net=tokenIn*80/100;return t==0?0:q*net/(t+net);}
    function syncOracle() external nonReentrant {_syncOracle();}
    function _syncOracle() private {
        (uint256 t,uint256 q)=reserves();require(t>0&&q>0,'NO_LIQUIDITY');uint256 price=q*1 ether/t;
        uint256 day=token.currentDay();uint256 opening=oracle.openingDay()==day?oracle.opening():price;
        oracle.setPrices(price,opening,day);
    }
    function buy(uint256 quoteIn,uint256 minTokenOut) external nonReentrant {
        require(quoteIn>0,'ZERO_AMOUNT');(uint256 t,uint256 q)=reserves();require(t>0&&q>0,'NO_LIQUIDITY');
        quote.safeTransferFrom(msg.sender,address(this),quoteIn);uint256 actual=quote.balanceOf(address(this))-q;
        uint256 gross=t*actual/(q+actual);uint256 beforeBalance=token.balanceOf(msg.sender);
        IERC20(address(token)).safeTransfer(msg.sender,gross);uint256 received=token.balanceOf(msg.sender)-beforeBalance;
        require(received>=minTokenOut&&received>0,'MIN_OUT');_syncOracle();emit Swap(msg.sender,true,actual,received);
    }
    function sell(uint256 tokenIn,uint256 minQuoteOut) external nonReentrant {
        require(tokenIn>0,'ZERO_AMOUNT');_syncOracle();(uint256 t,uint256 q)=reserves();
        IERC20(address(token)).safeTransferFrom(msg.sender,address(this),tokenIn);uint256 actual=token.balanceOf(address(this))-t;
        uint256 output=q*actual/(t+actual);uint256 beforeBalance=quote.balanceOf(msg.sender);quote.safeTransfer(msg.sender,output);
        uint256 received=quote.balanceOf(msg.sender)-beforeBalance;require(received>=minQuoteOut&&received>0,'MIN_OUT');
        _syncOracle();emit Swap(msg.sender,false,actual,received);
    }
}
