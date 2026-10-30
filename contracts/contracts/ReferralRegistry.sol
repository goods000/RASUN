// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract ReferralRegistry {
    mapping(address=>address) public inviter;
    mapping(address=>uint256) public boundDay;
    address[] private accounts;
    mapping(address=>bool) private known;
    struct Count { uint256 day; uint256 value; }
    Count[] private counts;
    function accountAt(uint256 index) external view returns(address){return accounts[index];}
    function accountCountAt(uint256 day) external view returns(uint256){
        uint256 lo;uint256 hi=counts.length;
        while(lo<hi){uint256 m=(lo+hi)/2;if(counts[m].day<=day)lo=m+1;else hi=m;}
        return lo==0?0:counts[lo-1].value;
    }
    function _register(address account,uint256 day) private {
        if(known[account])return;known[account]=true;accounts.push(account);
        if(counts.length>0&&counts[counts.length-1].day==day)counts[counts.length-1].value=accounts.length;
        else counts.push(Count(day,accounts.length));
    }
    event Bound(address indexed invitee,address indexed inviter,uint256 day);
    function _currentDay() internal view virtual returns(uint256){return (block.timestamp+8 hours)/1 days;}
    function bind(address parent) external {
        require(parent!=address(0)&&parent!=msg.sender,'INVALID_INVITER');require(inviter[msg.sender]==address(0),'ALREADY_BOUND');
        address cursor=parent;uint256 depth;
        while(cursor!=address(0)){require(cursor!=msg.sender,'CYCLE');require(depth++<256,'DEPTH_LIMIT');cursor=inviter[cursor];}
        uint256 day=_currentDay();inviter[msg.sender]=parent;boundDay[msg.sender]=day;_register(msg.sender,day);_register(parent,day);emit Bound(msg.sender,parent,day);
    }
    function inviterAt(address account,uint256 day) external view returns(address){return boundDay[account]<=day?inviter[account]:address(0);}
}
