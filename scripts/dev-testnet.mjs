import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import rpc from "./rpc-provider.cjs";
import diagnostics from "./deployment-error.cjs";
import { root, env, command, run, waitFor, stop } from "./process.mjs";
import { reserveDevPorts } from "./ui-ports.mjs";
import {
  testnetRuntime,
  validateTestnet,
  PUBLIC_RPC,
} from "./testnet-runtime.mjs";
const require = createRequire(path.join(root, "apps/api/package.json"));
const { parse } = require("dotenv");
const settings = {
  ...(fs.existsSync(path.join(root, ".env"))
    ? parse(fs.readFileSync(path.join(root, ".env")))
    : {}),
  ...process.env,
};
const children = [];
let ports,
  provider,
  runtime,
  closing = false;
let stage = "deployment file and RPC validation";
function close(code = 0) {
  if (closing) return;
  closing = true;
  process.exitCode = code;
  void ports?.release();
  provider?.destroy();
  for (const c of children.reverse()) stop(c);
  setTimeout(() => process.exit(code), 300).unref();
}
process.on("SIGINT", () => close());
process.on("SIGTERM", () => close());
try {
  const file = path.resolve(
    root,
    settings.DEPLOYMENT_FILE || "deployments/testnet.json",
  );
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  provider = rpc.createRpcProvider(
    settings.BSC_TESTNET_RPC_URL || PUBLIC_RPC,
    settings,
  );
  await validateTestnet(config, provider, settings.TESTNET_FIXTURE === "1");
  if (config.chainId === 31337)
    console.log(
      "TESTNET_FIXTURE=1: LOCAL HARDHAT FIXTURE. This is not evidence of public BSC deployment.",
    );
  ports = await reserveDevPorts({ api: 3000, dapp: 5173, admin: 5174 });
  runtime = testnetRuntime(
    root,
    settings.RASUN_DEV_RUN_ID || randomUUID(),
    ports,
    config,
    settings,
  );
  Object.assign(env, runtime.environment);
  for (const name of [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
  ]) {
    if (settings[name] !== undefined) env[name] = settings[name];
  }
  // Never copy root dotenv credentials into child environments.
  for (const key of Object.keys(env))
    if (/PRIVATE_KEY|MNEMONIC|DEPLOYER_KEY/i.test(key)) delete env[key];
  fs.mkdirSync(runtime.urls.logs, { recursive: true });
  stage = "database initialization";
  await run(["db:setup"]);
  stage = "API build";
  await run(["--filter", "@rasun/api", "build"]);
  function start(name, args) {
    const fd = fs.openSync(path.join(runtime.urls.logs, name + ".log"), "w");
    const child = command(args, {
      detached: process.platform !== "win32",
      stdio: ["ignore", fd, fd],
    });
    fs.closeSync(fd);
    children.push(child);
    child.on("error", () => close(1));
    child.on("exit", () => {
      if (!closing) {
        console.error(name + " exited; see " + runtime.urls.logs);
        close(1);
      }
    });
  }
  await ports.release("api");
  stage = "API process readiness";
  console.log(`Starting API: ${runtime.urls.api}; logs: ${runtime.urls.logs}`);
  start("api", ["--filter", "@rasun/api", "start"]);
  await waitFor(
    runtime.urls.api + "/api/live",
    (d) =>
      d.ok &&
      d.runId === runtime.urls.runId &&
      d.chainId === config.chainId &&
      d.token?.toLowerCase() === config.addresses.token.toLowerCase(),
    120000,
  );
  const actual = await (await fetch(runtime.urls.api + "/api/config")).json();
  if (
    actual.chainId !== config.chainId ||
    actual.mode !== "testnet" ||
    !actual.sandbox ||
    actual.addresses.token.toLowerCase() !==
      config.addresses.token.toLowerCase()
  )
    throw Error("Testnet API deployment mismatch");
  for (const name of ["dapp", "admin"]) {
    stage = name + " startup";
    await ports.release(name);
    start(name, ["dev:" + name]);
    await waitFor(
      `http://127.0.0.1:${ports[name]}/__rasun_dev__`,
      (d) => d.application === name && d.runId === runtime.urls.runId,
    );
  }
  fs.writeFileSync(
    path.join(runtime.urls.logs, "urls.json"),
    JSON.stringify(runtime.urls, null, 2),
  );
  console.log(
    `RASUN ${config.chainId === 97 ? "BSC TESTNET 97" : "LOCAL TESTNET FIXTURE"} ready\nDApp: ${runtime.urls.dapp}\nAdmin: ${runtime.urls.admin}\nAPI: ${runtime.urls.api}\nLogs: ${runtime.urls.logs}`,
  );
  provider.destroy();
} catch (error) {
  if (stage === "database initialization") {
    console.error(
      "Local SQLite initialization failed; see the database error above. For SQLITE_BUSY stop the other RASUN dev:testnet/API instance with Ctrl+C. Do not delete the database.",
    );
  } else if (stage === "API process readiness") {
    console.error(
      "Local API process readiness failed; inspect api.log. This check does not query BSC RPC.",
    );
  } else console.error(diagnostics.deploymentError(error, stage));
  if (runtime) console.error("Startup logs: " + runtime.urls.logs);
  console.error(
    "Testnet startup failed; verify RPC access, deployment metadata/contracts and child logs. No local chain fallback or deployment was attempted.",
  );
  close(1);
}
