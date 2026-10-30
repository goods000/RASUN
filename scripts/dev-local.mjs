import { randomUUID } from "node:crypto";
import { reserveUiPorts } from "./ui-ports.mjs";
import {
  command,
  run,
  waitFor,
  stop,
  root,
  env,
  localOverrides,
} from "./process.mjs";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
Object.assign(env, localOverrides);
const children = [];
const runId = process.env.RASUN_DEV_RUN_ID || randomUUID();
const runtimeFile = path.join(root, ".local/dev-urls.json");
let uiPorts;
let closing = false;
function close(code = 0) {
  if (closing) return;
  closing = true;
  process.exitCode = code;
  void uiPorts?.release();
  try {
    if (JSON.parse(fs.readFileSync(runtimeFile, "utf8")).runId === runId)
      fs.unlinkSync(runtimeFile);
  } catch {}
  for (const p of children.reverse()) stop(p);
  setTimeout(() => process.exit(code), 300).unref();
}
process.on("SIGINT", () => close());
process.on("SIGTERM", () => close());
async function assertFree(port) {
  await new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", () =>
      reject(
        Error(
          `Port ${port} is already in use. Stop that service before starting the local stack.`,
        ),
      ),
    );
    s.listen(port, "127.0.0.1", () => s.close(resolve));
  });
}
function start(name, args, childEnv) {
  const dir = path.join(root, ".local/logs");
  fs.mkdirSync(dir, { recursive: true });
  const fd = fs.openSync(path.join(dir, name + ".log"), "w");
  const child = command(args, {
    detached: process.platform !== "win32",
    stdio: ["ignore", fd, fd],
    ...(childEnv ? { env: childEnv } : {}),
  });
  fs.closeSync(fd);
  children.push(child);
  child.on("exit", (code) => {
    if (!closing) {
      console.error(`${name} stopped (${code}). See .local/logs/${name}.log`);
      close(1);
    }
  });
  child.on("error", (e) => {
    console.error(e.message);
    close(1);
  });
  return child;
}
try {
  for (const port of [8545, 3000]) await assertFree(port);
  await run(["db:setup"]);
  await run(["--filter", "@rasun/api", "build"]);
  start("chain", [
    "--dir",
    "contracts",
    "exec",
    "hardhat",
    "node",
    "--hostname",
    "127.0.0.1",
  ]);
  const until = Date.now() + 60000;
  let ready = false;
  while (Date.now() < until) {
    try {
      const r = await fetch("http://127.0.0.1:8545", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_chainId",
          params: [],
        }),
      });
      if ((await r.json()).result === "0x7a69") {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!ready) throw Error("Local chain failed to start");
  await run([
    "--dir",
    "contracts",
    "exec",
    "hardhat",
    "run",
    "scripts/deploy.ts",
    "--network",
    "localhost",
  ]);
  uiPorts = await reserveUiPorts();
  start("api", ["--filter", "@rasun/api", "start"], {
    ...env,
    RPC_URL: "http://127.0.0.1:8545",
    DEPLOYMENT_FILE: "deployments/local.json",
    PORT: "3000",
    CONFIRMATIONS: "0",
    PUBLIC_RPC_URL: "http://127.0.0.1:8545",
    CORS_ORIGINS: `http://localhost:${uiPorts.dapp},http://127.0.0.1:${uiPorts.dapp},http://localhost:${uiPorts.admin},http://127.0.0.1:${uiPorts.admin}`,
  });
  await waitFor(
    "http://127.0.0.1:3000/api/health",
    (h) => h.chain === "ready" && !h.index.error,
  );
  const actual = await (await fetch("http://127.0.0.1:3000/api/config")).json();
  const expected = JSON.parse(
    fs.readFileSync(path.join(root, "deployments/local.json"), "utf8"),
  );
  if (
    actual.chainId !== 31337 ||
    actual.mode !== "local" ||
    actual.addresses.token !== expected.addresses.token
  )
    throw Error("Local API deployment mismatch");
  const uiEnv = {
    ...env,
    RASUN_DAPP_PORT: String(uiPorts.dapp),
    RASUN_ADMIN_PORT: String(uiPorts.admin),
    RASUN_UI_STRICT_PORT: "1",
    RASUN_DEV_RUN_ID: runId,
  };
  await uiPorts.release();
  start("dapp", ["dev:dapp"], uiEnv);
  start("admin", ["dev:admin"], uiEnv);
  for (const [application, port] of [
    ["dapp", uiPorts.dapp],
    ["admin", uiPorts.admin],
  ]) {
    await waitFor(
      `http://127.0.0.1:${port}/__rasun_dev__`,
      (data) => data.application === application && data.runId === runId,
    );
  }
  const urls = {
    runId,
    dapp: `http://localhost:${uiPorts.dapp}`,
    admin: `http://localhost:${uiPorts.admin}`,
    api: "http://127.0.0.1:3000",
    chain: "http://127.0.0.1:8545",
  };
  fs.writeFileSync(runtimeFile, JSON.stringify(urls, null, 2));
  console.log(
    `RASUN local stack ready: DApp port ${uiPorts.dapp}, admin ${uiPorts.admin}, API 3000, local chain 8545.`,
  );
  console.log(`DApp: ${urls.dapp}\nAdmin: ${urls.admin}`);
  console.log(
    "Local-only seeded accounts, test oracle and sample rewards. Logs: .local/logs. Ctrl+C stops the services started by this command.",
  );
} catch (e) {
  console.error(e.message);
  close(1);
}
