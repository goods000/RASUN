# BSC Testnet Implementation Plan

User goal: real transactions, RASUN balances and mining rewards on BSC testnet 97. Keep raw private keys on the user's computer, never chat/Git; no mainnet or real-value asset deployment. Public deployment is not complete until receipts/addresses on chain 97 are verified.

## Chosen scope
- Preserve production-day base contracts and algorithms. Separate TESTNET ONLY token/registry clock at a default 300-second epoch to observe actual on-chain rewards quickly. Emit metadata epochSeconds/accelerated, show labels; do not call this a real daily yield.
- Deploy chain-97 sandbox RASUN/tUSDT constant-product pool and faucet. tUSDT is a worthless test token, not real USDT or a PancakeSwap integration. 3% buy, 5%+crash sell token taxes still apply. Pool oracle is explicitly a test oracle, not a production feed.
- User faucet receives escrowed initial-supply RASUN and test quote tokens, not unauthorized RASUN mints. Native tBNB must come from a BSC testnet faucet.
- Testnet runner reads deployed config and confirmed chain data, never starts/reset a local blockchain. Public wallet operations use BSC97, show native tBNB, explorer links, transaction receipts and actionable insufficient-gas messages.
- Settlement is permissionless: any wallet can begin/process a bounded batch. Optional local keeper runs a user-funded testnet signer, skips idle work, resumes unfinished settlement, refreshes test price quotes; no API private-key custody.

## Shared interfaces
Deployment JSON: existing config plus mode:'testnet', chainId:97 (test fixture may use 31337), sandbox:true, epochSeconds:300 or 86400, accelerated:boolean, addresses:{token,registry,mining,oracle,quote,pool,faucet}, abis for every address, deploymentBlock, localIdentity:null on97. Sandbox only runs on97/31337.
Pool ABI: reserves() -> (uint256 tokenReserve,uint256 quoteReserve); quoteBuy(uint256 quoteIn)->uint256 grossTokenOut; quoteSell(uint256 tokenIn)->uint256 quoteOut (conservative include max tax); buy(uint256 quoteIn,uint256 minTokenOut); sell(uint256 tokenIn,uint256 minQuoteOut); syncOracle(); event Swap(address indexed account,bool buy,uint256 amountIn,uint256 amountOut).
Faucet ABI: claim(); nextClaimAt(address)->uint256; grants 100 RASUN plus 1000 tUSDT from escrow/authorized test mint once per24h; event FaucetClaimed(address indexed account,uint256 tokenAmount,uint256 quoteAmount).
Quote ERC20: standard decimals18; owner-only mint; owner assigned to faucet after seeding pool; no value claim.
Token TestnetRASUNToken constructor: same7 base addresses plus epochSeconds; virtual currentDay uses test clock. TestnetReferralRegistry(token) uses same currentDay as token.
GET /api/config includes sandbox, epochSeconds, accelerated, addresses/abis; GET /api/market?wallet=0x(optional) returns reserves:{token,quote}, quoteBalance, allowances:{quote,token}, faucet:{nextClaimAt,available}, nativeBalance, currentEpoch, nextEpochAt seconds; amounts base-unit strings; unavailable sandbox 404.
GET /api/overview adds epochSeconds, accelerated, nextEpochAt. Zero rewards do not show claim CTA unless explicit separate history advance.

## Tasks and evidence
1. Contracts, sandbox integration tests and deploy-testnet script: real transfers/swaps/tax, faucet limits, real-time epoch settlement, no time travel on97, chain restrictions, minOut and reentrancy. Deployment preflight checks chain97, balances/keys presence, config file guards, waits every transaction; local fixture export supports full browser tests.
2. Backend/public-testnet launcher/keeper: no local fallback, key-free serving, separate read-only RPC/public wallet RPC, dynamic UI/API ports, persistent deployment-scoped index, bounded keeper transactions. Unit tests and API integration.
3. DApp: BSC mode, faucet/swap/approve/minOut/settlement, zero-reward state, tBNB balance, token import, seven-language action labels, explorer and progress. Browser tests on97-compatible local fixture (clearly not proof of public deployment).
4. Final integration/review/README, push branch, obtain actual public deploy receipts from secure user-run workflow if no funded signer is available here.
