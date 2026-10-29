
import { HardhatUserConfig, subtask } from "hardhat/config"
import { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } from "hardhat/builtin-tasks/task-names"
import path from "node:path"

// 保留项目原有的 Hardhat 插件导入
import "@nomicfoundation/hardhat-toolbox"

subtask(
  TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD,
  async (args: { solcVersion: string }, _hre, runSuper) => {
    if (args.solcVersion === "0.8.24") {
      return {
        compilerPath: require.resolve("solc/soljson.js"),
        isSolcJs: true,
        version: "0.8.24",
        longVersion: "0.8.24+commit.e11b9ed9"
      }
    }

    return runSuper()
  }
)

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  }
}

export default config
