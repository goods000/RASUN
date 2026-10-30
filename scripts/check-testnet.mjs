// Explicit local integration evidence only; this never proves deployment on public chain97.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { command, run, env, root, stop } from "./process.mjs";
import { reserveDevPorts } from "./ui-ports.mjs";
const runId = randomUUID();
const dir = path.join(root, ".local/testnet-fixtures", runId);
fs.mkdirSync(dir, { recursive: true });
const children = [];
let closing = false,
  ports;
function close(code = 0) {
  if (closing) return;
  closing = true;
  process.exitCode = code;
  void ports?.release();
  for (const child of children.reverse()) stop(child);
  setTimeout(() => process.exit(code), 300).unref();
}
process.on("SIGINT", () => close());
process.on("SIGTERM", () => close());
function start(args, file) {
  const fd = fs.openSync(file, "w");
  const child = command(args, {
    detached: process.platform !== "win32",
    stdio: ["ignore", fd, fd],
  });
  fs.closeSync(fd);
  children.push(child);
  child.on("error", () => close(1));
  child.on("exit", () => {
    if (!closing) close(1);
  });
  return child;
}
async function until(check, timeout = 120000) {
  const end = Date.now() + timeout;
  while (Date.now() < end && !closing) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw Error("Fixture readiness timed out");
}
try {
  ports = await reserveDevPorts({ chain: 18545 });
  const rpc = `http://127.0.0.1:${ports.chain}`;
  await ports.release();
  Object.assign(env, {
    RASUN_TESTNET_FIXTURE: "1",
    TESTNET_FIXTURE: "1",
    RASUN_LOCAL_RPC_URL: rpc,
    BSC_TESTNET_RPC_URL: rpc,
    PUBLIC_RPC_URL: rpc,
    DEPLOYMENT_FILE: path.join(dir, "deployment.json"),
    RASUN_DEV_RUN_ID: runId,
  });
  // Known local Hardhat allocation address only; no signing key is put in this harness.
  for (const name of [
    "MINER_ADDRESS",
    "LIQUIDITY_ADDRESS",
    "TECH_ADDRESS",
    "OPERATIONS_ADDRESS",
    "DAO_ADDRESS",
    "STABILIZATION_ADDRESS",
  ])
    env[name] = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
  start(
    [
      "--dir",
      "contracts",
      "exec",
      "hardhat",
      "node",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(ports.chain),
    ],
    path.join(dir, "chain.log"),
  );
  await until(async () => {
    try {
      const r = await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "hardhat_metadata",
          params: [],
        }),
        signal: AbortSignal.timeout(1500),
      });
      return Number((await r.json()).result?.chainId) === 31337;
    } catch {
      return false;
    }
  });
  await run([
    "--dir",
    "contracts",
    "exec",
    "hardhat",
    "run",
    "scripts/deploy-testnet.ts",
    "--network",
    "localhost",
  ]);
  const config = JSON.parse(fs.readFileSync(env.DEPLOYMENT_FILE, "utf8"));
  const urlsFile = path.join(
    root,
    ".local/testnet",
    "31337",
    config.addresses.token.toLowerCase(),
    "runs",
    runId,
    "urls.json",
  );
  start(
    ["exec", "node", "scripts/dev-testnet.mjs"],
    path.join(dir, "launcher.log"),
  );
  await until(async () => fs.existsSync(urlsFile), 180000);
  const urls = JSON.parse(fs.readFileSync(urlsFile, "utf8"));
  env.TESTNET_API_URL = urls.api + "/api";
  await run(["exec", "node", "apps/api/test/testnet/live.test.cjs"]);
  const evidence = {
    ...urls,
    rpc,
    fixture: true,
    publicDeploymentEvidence: false,
    fixtureDirectory: dir,
  };
  fs.writeFileSync(
    path.join(dir, "urls.json"),
    JSON.stringify(evidence, null, 2),
  );
  fs.writeFileSync(
    path.join(os.tmpdir(), "bsc-testnet-fixture-urls.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log("LOCAL HARDHAT TESTNET FIXTURE: " + JSON.stringify(evidence));
  Object.assign(env, {
    TEST_API_URL: urls.api + "/api",
    TEST_RPC_URL: rpc,
    RASUN_DAPP_URL: urls.dapp,
  });
  if (!process.argv.includes("--serve")) {
    await run(["test:testnet-ui"]);
    close();
  }
} catch (error) {
  console.error(error.message);
  console.error("Fixture logs: " + dir);
  close(1);
}
