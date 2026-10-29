# RASUN Monorepo — 开发骨架

> 这是依据《雷达 RASUN 需求文档》创建的开发脚手架，不是可上线的完整 DeFi 系统。

## 环境
- Node.js 20 LTS 或 22 LTS（推荐 Node.js 22）
- pnpm 9（`corepack enable` 后 `corepack prepare pnpm@9.15.9 --activate`）

## 启动
```bash
pnpm install
cp apps/api/.env.example apps/api/.env  # Windows PowerShell: Copy-Item apps/api/.env.example apps/api/.env
pnpm db:setup
pnpm dev:api
```
另开终端：
```bash
pnpm dev:admin
```
再开终端：
```bash
pnpm dev:dapp
```
地址：API http://localhost:3000/api/health；后台 http://localhost:5174；DApp http://localhost:5173。

## 合约本地测试
```bash
pnpm contract:compile
pnpm contract:test
```
编译需要首次下载 Solidity 编译器（需要联网）。

## 安全与限制
- `RASUNToken.sol` 仅是基础 ERC20 骨架，初始发行 200 万枚，合约 owner 可以增发但不能超过 1 亿。**此权限不适合直接部署主网**，必须改为发行控制器及多签/时间锁，并完成审计。
- 尚未实现买卖税、动态暴跌税、邀请关系、排名快照、Merkle 收益、钱包登录。
- `uni-app` 相关 `@dcloudio` 包使用 `latest`，必须在首次成功安装后提交锁文件并确保 DCloud 依赖版本匹配；若当前最新 CLI 需要其他 Vite 版本，按官方 uni-app 模板锁定配套版本。
- SQLite 采用 Prisma 6 的 datasource URL 配置；不可直接用 Prisma 7 的配置替换。
- 不要提交 `.env`、数据库或私钥。
- 合约只在本地 Hardhat 测试，不包含主网部署命令。

## 需求待确认
- 发行量阶段累计与 1 亿上限是否一致。
- 并列排名与跳号规则、快照时点。
- 推广算力超过 1000 的分段公式及开立方根处理。
- 价格预言机的抗操纵方式。
- 纯链上还是链下计算+链上验证。
