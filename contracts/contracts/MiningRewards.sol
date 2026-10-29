// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ReentrancyGuard} from '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import {Math} from '@openzeppelin/contracts/utils/math/Math.sol';
import {RASUNToken} from './RASUNToken.sol';
import {ReferralRegistry} from './ReferralRegistry.sol';
/// @notice Permissionless historical settlement; O(N^2), bounded per transaction.
contract MiningRewards is ReentrancyGuard {
    RASUNToken public immutable token;
    ReferralRegistry public immutable registry;
    uint256 public immutable startDay;
    uint256 public nextDay;
    uint256 public activeDay;
    uint256 public unallocated;
    uint256[] private monthly;
    struct Epoch {
        uint256 stage;uint256 sourceCursor;uint256 tokenCount;uint256 referralCount;
        uint256 cursor;uint256 other;uint256 count;
        uint256 holdingTotal;uint256 referralTotal;uint256 holdingPrefix;uint256 referralPrefix;
        uint256 amount;bool finalized;
    }
    mapping(uint256=>Epoch) private epochData;
    mapping(uint256=>address[]) private candidates;
    mapping(uint256=>mapping(address=>bool)) private seen;
    mapping(uint256=>mapping(address=>mapping(uint8=>uint256))) public weight;
    mapping(uint256=>mapping(address=>mapping(uint8=>uint256))) public rewards;
    mapping(uint256=>mapping(address=>uint256)) private referralMax;
    mapping(address=>mapping(uint8=>uint256)) public claimCursor;
    event DayStarted(uint256 indexed day,uint256 amount);
    event DayFinalized(uint256 indexed day,uint256 holdingTotal,uint256 referralTotal,uint256 amount);
    event Claimed(address indexed account,uint8 indexed kind,uint256 amount,uint256 fromDay,uint256 toDay);
    constructor(RASUNToken token_,ReferralRegistry registry_,uint256 startDay_){
        require(startDay_>=token_.currentDay(),'PAST_START');token=token_;registry=registry_;startDay=startDay_;nextDay=startDay_;
        uint256 amount=100000 ether;uint256 remaining=98000000 ether;
        for(uint256 m;remaining>0;m++){
            if(m>0)amount=amount*(m<6?110:m<42?105:m<78?103:101)/100;
            uint256 allocation=amount<remaining?amount:remaining;monthly.push(allocation);remaining-=allocation;
        }
    }
    function monthlyEmission(uint256 month) public view returns(uint256){return month<monthly.length?monthly[month]:0;}
    function emission(uint256 day) public view returns(uint256){
        if(day<startDay)return 0;uint256 elapsed=day-startDay;uint256 amount=monthlyEmission(elapsed/30);uint256 offset=elapsed%30;
        return amount*(offset+1)/30-amount*offset/30;
    }
    function epochs(uint256 day) external view returns(Epoch memory){return epochData[day];}
    function candidateAt(uint256 day,uint256 index) external view returns(address){return candidates[day][index];}
    function beginDay() external {
        require(token.frozen()&&activeDay==0&&nextDay<token.currentDay(),'NOT_READY');
        activeDay=nextDay;Epoch storage e=epochData[nextDay];e.tokenCount=token.holderCountAt(nextDay);e.referralCount=registry.accountCountAt(nextDay);e.amount=emission(nextDay);
        emit DayStarted(nextDay,e.amount);
    }
    function transformed(uint256 value) public pure returns(uint256){return value<=1000 ether?value*10:value+9000 ether;}
    function cubeRoot(uint256 value) public pure returns(uint256){
        // cbrt(value / 1e18) in 18-decimal fixed point. Cap bounds value*1e36 below uint256 max.
        uint256 target=value*1e36;uint256 lo;uint256 hi=1e27;
        while(lo+1<hi){uint256 mid=(lo+hi)/2;if(mid<=target/mid/mid)lo=mid;else hi=mid;}
        return lo;
    }
    function process(uint256 maxOperations) external {
        require(activeDay!=0&&maxOperations>0&&maxOperations<=512,'INVALID_BATCH');
        uint256 day=activeDay;Epoch storage e=epochData[day];
        for(uint256 op;op<maxOperations&&activeDay!=0;op++){
            if(e.stage==0){
                if(e.sourceCursor==e.tokenCount+e.referralCount){e.stage=1;e.count=candidates[day].length;continue;}
                uint256 i=e.sourceCursor++;
                address account=i<e.tokenCount?token.holderAt(i):registry.accountAt(i-e.tokenCount);
                if(!token.excluded(account)&&!seen[day][account]){seen[day][account]=true;candidates[day].push(account);}
            }else if(e.stage==1){
                if(e.cursor==e.count){e.stage=2;e.cursor=0;continue;}
                address account=candidates[day][e.cursor];uint256 balance=token.balanceAt(account,day);
                if(e.other==0&&balance>=1 ether)weight[day][account][0]=1;
                if(e.other<e.count){
                    address other=candidates[day][e.other++];uint256 b=token.balanceAt(other,day);
                    if(balance>=1 ether&&b>=1 ether&&b<balance)weight[day][account][0]++;
                    if(registry.inviterAt(other,day)==account){weight[day][account][1]+=transformed(b);if(b>referralMax[day][account])referralMax[day][account]=b;}
                }else{
                    uint256 max=referralMax[day][account];
                    if(max>0)weight[day][account][1]=weight[day][account][1]-transformed(max)+cubeRoot(max);
                    e.holdingTotal+=weight[day][account][0];e.referralTotal+=weight[day][account][1];e.cursor++;e.other=0;
                }
            }else{
                if(e.cursor==e.count){_finalize(day,e);continue;}
                address account=candidates[day][e.cursor++];uint256 h=e.amount/2;uint256 r=e.amount-h;
                if(e.holdingTotal>0){
                    uint256 before=e.holdingPrefix;e.holdingPrefix+=weight[day][account][0];
                    rewards[day][account][0]=Math.mulDiv(h,e.holdingPrefix,e.holdingTotal)-Math.mulDiv(h,before,e.holdingTotal);
                }
                if(e.referralTotal>0){
                    uint256 before=e.referralPrefix;e.referralPrefix+=weight[day][account][1];
                    rewards[day][account][1]=Math.mulDiv(r,e.referralPrefix,e.referralTotal)-Math.mulDiv(r,before,e.referralTotal);
                }
            }
        }
    }
    function _finalize(uint256 day,Epoch storage e) private {
        if(e.holdingTotal==0)unallocated+=e.amount/2;
        if(e.referralTotal==0)unallocated+=e.amount-e.amount/2;
        token.mintReward(day,address(this),e.amount);e.finalized=true;activeDay=0;nextDay=day+1;
        emit DayFinalized(day,e.holdingTotal,e.referralTotal,e.amount);
    }
    function _range(address account,uint8 kind,uint256 maxDays) private view returns(uint256 from,uint256 to){
        require(kind<2&&maxDays>0&&maxDays<=365,'INVALID_CLAIM');from=claimCursor[account][kind];if(from==0)from=startDay;
        to=from+maxDays;if(to>nextDay)to=nextDay;
    }
    function pending(address account,uint8 kind,uint256 maxDays) external view returns(uint256 amount){
        (uint256 from,uint256 to)=_range(account,kind,maxDays);for(uint256 day=from;day<to;day++)amount+=rewards[day][account][kind];
    }
    function claim(uint8 kind,uint256 maxDays) external nonReentrant {
        (uint256 from,uint256 to)=_range(msg.sender,kind,maxDays);require(to>from,'NOTHING_TO_CLAIM');uint256 amount;
        for(uint256 day=from;day<to;day++)amount+=rewards[day][msg.sender][kind];
        claimCursor[msg.sender][kind]=to;if(amount>0)require(token.transfer(msg.sender,amount),'TRANSFER_FAILED');
        emit Claimed(msg.sender,kind,amount,from,to);
    }
}
