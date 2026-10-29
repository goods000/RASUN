// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC20} from '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import {Ownable} from '@openzeppelin/contracts/access/Ownable.sol';
interface IPriceOracle {
    function quote() external view returns (uint256 price, uint256 opening, uint256 updatedAt, uint256 openingDay);
}
/// @notice Local/testnet implementation. Cumulative mint cap survives burning.
contract RASUNToken is ERC20, Ownable {
    uint256 public constant MAX_SUPPLY = 100_000_000 ether;
    uint256 public totalMinted;
    uint256 public totalBurned;
    address public immutable technology;
    address public immutable operations;
    address public immutable dao;
    address public immutable stabilization;
    address public mining;
    IPriceOracle public oracle;
    bool public frozen;
    mapping(address => bool) public isPool;
    mapping(address => bool) public excluded;
    mapping(uint256 => bool) public mintedDay;
    struct Point {uint64 day; uint192 value;}
    mapping(address => Point[]) private history;
    Point[] private counts;
    address[] private holders;
    mapping(address=>bool) private registered;
    event ConfigurationFrozen(address mining, address oracle);
    event TaxPaid(address indexed trader, bool sell, uint256 baseTax, uint256 crashTax);
    constructor(address admin,address miner,address liquidity,address tech,address ops,address dao_,address stabilization_)
        ERC20('RASUN','RASUN') Ownable(admin) {
        require(miner!=address(0)&&liquidity!=address(0)&&tech!=address(0)&&ops!=address(0)&&dao_!=address(0)&&stabilization_!=address(0),'ZERO_ADDRESS');
        technology=tech; operations=ops; dao=dao_; stabilization=stabilization_;
        excluded[address(0)]=true;excluded[address(0xdead)]=true;excluded[address(this)]=true;
        excluded[miner]=true;excluded[liquidity]=true;excluded[tech]=true;excluded[ops]=true;excluded[dao_]=true;excluded[stabilization_]=true;
        _mint(miner,1_000_000 ether);_mint(liquidity,1_000_000 ether);totalMinted=2_000_000 ether;
    }
    function currentDay() public view returns(uint256){return (block.timestamp+8 hours)/1 days;}
    function configure(address mining_,address oracle_,address[] calldata pools) external onlyOwner {
        require(!frozen && mining==address(0),'LOCKED');require(mining_.code.length>0&&oracle_.code.length>0,'CONTRACT_REQUIRED');
        mining=mining_;oracle=IPriceOracle(oracle_);excluded[mining_]=true;
        for(uint256 i;i<pools.length;i++){require(pools[i]!=address(0),'ZERO_ADDRESS');isPool[pools[i]]=true;excluded[pools[i]]=true;}
    }
    function freeze() external onlyOwner {require(!frozen&&mining!=address(0),'NOT_CONFIGURED');frozen=true;emit ConfigurationFrozen(mining,address(oracle));}
    function mintReward(uint256 day,address to,uint256 amount) external {
        require(frozen&&msg.sender==mining&&to==mining,'ONLY_MINING');require(day<currentDay()&&!mintedDay[day],'INVALID_DAY');
        require(totalMinted+amount<=MAX_SUPPLY,'CAP_EXCEEDED');mintedDay[day]=true;totalMinted+=amount;_mint(to,amount);
    }
    function holderAt(uint256 i) external view returns(address){return holders[i];}
    function holderCountAt(uint256 day) external view returns(uint256){return _lookup(counts,day);}
    function balanceAt(address who,uint256 day) external view returns(uint256){return excluded[who]?0:_lookup(history[who],day);}
    function _lookup(Point[] storage points,uint256 day) private view returns(uint256){
        uint256 low;uint256 high=points.length;
        while(low<high){uint256 mid=(low+high)/2;if(points[mid].day<=day)low=mid+1;else high=mid;}
        return low==0?0:points[low-1].value;
    }
    function _write(Point[] storage points,uint256 value) private {
        uint64 day=uint64(currentDay());uint256 len=points.length;
        if(len>0&&points[len-1].day==day)points[len-1].value=uint192(value);
        else points.push(Point(day,uint192(value)));
    }
    function _record(address who) private {
        if(excluded[who])return;
        if(!registered[who]&&balanceOf(who)>0){registered[who]=true;holders.push(who);_write(counts,holders.length);}
        if(registered[who])_write(history[who],balanceOf(who));
    }
    function crashRate() public view returns(uint256){
        (uint256 price,uint256 opening,uint256 updatedAt,uint256 day)=oracle.quote();
        require(price>0&&opening>0&&day==currentDay()&&updatedAt<=block.timestamp&&block.timestamp-updatedAt<=1 hours,'INVALID_PRICE');
        if(price>=opening)return 0;
        uint256 drop=(opening-price)*10000/opening;
        return drop>=3000?1500:drop>=2000?1000:drop>=1000?500:0;
    }
    function _update(address from,address to,uint256 amount) internal override {
        bool sell=isPool[to]&&!isPool[from];bool buy=isPool[from]&&!isPool[to];
        if(from!=address(0)&&to!=address(0)&&(sell||buy)){
            require(frozen,'NOT_STARTED');uint256 unit=amount/100;
            uint256 crash=sell?amount*crashRate()/10000:0;
            uint256 base=unit*(sell?5:3);uint256 burn=unit+crash/2;
            super._update(from,address(0),burn);totalBurned+=burn;
            super._update(from,technology,unit);super._update(from,operations,unit);
            if(sell)super._update(from,dao,unit*2);
            if(crash>0)super._update(from,stabilization,crash-crash/2);
            super._update(from,to,amount-base-crash);emit TaxPaid(sell?from:to,sell,base,crash);
        }else super._update(from,to,amount);
        _record(from);_record(to);
    }
}
