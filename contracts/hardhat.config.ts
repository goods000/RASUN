import { config as loadEnv } from "dotenv";
import { HardhatUserConfig, subtask } from "hardhat/config";
import { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } from "hardhat/builtin-tasks/task-names";
import path from "node:path";
import fs from "node:fs";

// 保留项目原有的 Hardhat 插件导入
import "@nomicfoundation/hardhat-toolbox";

subtask(
  TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD,
  async (args: { solcVersion: string }, _hre, runSuper) => {
    if (args.solcVersion === "0.8.24") {
      return {
        compilerPath: require.resolve("solc/soljson.js"),
        isSolcJs: true,
        version: "0.8.24",
        longVersion: "0.8.24+commit.e11b9ed9",
      };
    }

    return runSuper();
  },
);

loadEnv({ path: path.resolve(__dirname, "../.env") });
let localRuntime: any = {};
try {
  localRuntime = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../.local/dev-urls.json"), "utf8"),
  );
} catch {}
const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    localhost: {
      url:
        process.env.RASUN_LOCAL_RPC_URL ||
        localRuntime.chain ||
        "http://127.0.0.1:0",
    },
    bscTestnet: {
      url:
        process.env.BSC_TESTNET_RPC_URL ||
        "https://bsc-testnet-rpc.publicnode.com",
      chainId: 97,
      accounts: process.env.DEPLOYER_PRIVATE_KEY
        ? [process.env.DEPLOYER_PRIVATE_KEY]
        : [],
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

export default config;
