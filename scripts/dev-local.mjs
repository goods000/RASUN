import { randomUUID } from "node:crypto";
import { reserveDevPorts, retryPort } from "./ui-ports.mjs";
import { localRuntime } from "./local-runtime.mjs";
import { command, run, waitFor, stop, root, env } from "./process.mjs";
import fs from "node:fs";
import path from "node:path";
const runId = process.env.RASUN_DEV_RUN_ID || randomUUID();
const runtimeFile = path.join(root, ".local/dev-urls.json");
const children = [];
let ports,
  runtime,
  closing = false;
function close(code = 0) {
  if (closing) return;
  closing = true;
  process.exitCode = code;
  void ports?.release();
  try {
    if (JSON.parse(fs.readFileSync(runtimeFile, "utf8")).runId === runId)
      fs.unlinkSync(runtimeFile);
  } catch {}
  for (const child of children.reverse()) stop(child);
  setTimeout(() => process.exit(code), 300).unref();
}
process.on("SIGINT", () => close());
process.on("SIGTERM", () => close());
function start(name, args, allowStartupFailure = false) {
  if (closing) throw Error("Startup interrupted");
  const dir = runtime.urls.logs;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name + ".log");
  const fd = fs.openSync(file, "w");
  const child = command(args, {
    detached: process.platform !== "win32",
    stdio: ["ignore", fd, fd],
  });
  fs.closeSync(fd);
  child.rasunStarting = allowStartupFailure;
  children.push(child);
  child.on("exit", (code) => {
    if (!closing && !child.rasunStarting) {
      console.error(`${name} stopped (${code}). See ${file}`);
      close(1);
    }
  });
  child.on("error", (error) => {
    child.rasunError = error;
    if (!child.rasunStarting) {
      console.error(error.message);
      close(1);
    }
  });
  return child;
}
try {
  ports = await reserveDevPorts();
  runtime = localRuntime(runId, ports);
  Object.assign(env, runtime.environment);
  await run(["db:setup"]);
  await run(["--filter", "@rasun/api", "build"]);
  await ports.release("chain");
  await retryPort(
    ports.chain,
    async (port) => {
      ports.chain = port;
      runtime = localRuntime(runId, ports);
      Object.assign(env, runtime.environment);
      const file = path.join(runtime.urls.logs, "chain.log");
      if (fs.existsSync(file))
        fs.copyFileSync(
          file,
          path.join(runtime.urls.logs, `chain-before-${port}.log`),
        );
      const chain = start(
        "chain",
        [
          "--dir",
          "contracts",
          "exec",
          "hardhat",
          "node",
          "--hostname",
          "127.0.0.1",
          "--port",
          String(port),
        ],
        true,
      );
      const until = Date.now() + 60000;
      let ready = false;
      while (!closing && Date.now() < until) {
        const log = fs.readFileSync(file, "utf8");
        if (log.includes(`JSON-RPC server at http://127.0.0.1:${port}`)) {
          try {
            const response = await fetch(runtime.urls.chain, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "eth_chainId",
                params: [],
              }),
              signal: AbortSignal.timeout(1500),
            });
            if ((await response.json()).result === "0x7a69") {
              ready = true;
              break;
            }
          } catch {}
        }
        if (chain.exitCode !== null || chain.signalCode || chain.rasunError)
          break;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      if (
        !ready ||
        chain.exitCode !== null ||
        chain.signalCode ||
        chain.rasunError
      ) {
        const log = fs.readFileSync(file, "utf8");
        const error =
          chain.rasunError || Error("Local chain failed to start; see " + file);
        if (/EADDRINUSE|address already in use/i.test(log))
          error.code = "EADDRINUSE";
        else if (/EACCES/i.test(log)) error.code = "EACCES";
        if (!error.code) stop(chain);
        throw error;
      }
      chain.rasunStarting = false;
    },
    {
      onRetry: (port) =>
        console.log(
          "Local chain port unavailable; automatically retrying " + port,
        ),
    },
  );
  env.RASUN_BOOTSTRAP_DEPLOY = runId;
  try {
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
  } finally {
    delete env.RASUN_BOOTSTRAP_DEPLOY;
  }

  await ports.release("api");
  start("api", ["--filter", "@rasun/api", "start"]);
  await waitFor(
    runtime.urls.api + "/api/health",
    (data) =>
      data.runId === runId && data.chain === "ready" && !data.index.error,
  );
  const actual = await (await fetch(runtime.urls.api + "/api/config")).json();
  const expected = JSON.parse(fs.readFileSync(runtime.urls.deployment, "utf8"));
  if (
    actual.chainId !== 31337 ||
    actual.mode !== "local" ||
    actual.addresses.token !== expected.addresses.token ||
    actual.rpcUrl !== runtime.urls.chain
  )
    throw Error("Local API deployment mismatch");
  await ports.release("dapp");
  start("dapp", ["dev:dapp"]);
  await ports.release("admin");
  start("admin", ["dev:admin"]);
  for (const [application, port] of [
    ["dapp", ports.dapp],
    ["admin", ports.admin],
  ])
    await waitFor(
      `http://127.0.0.1:${port}/__rasun_dev__`,
      (data) => data.application === application && data.runId === runId,
    );
  fs.writeFileSync(
    path.join(path.dirname(runtime.urls.deployment), "urls.json"),
    JSON.stringify(runtime.urls, null, 2),
  );
  fs.writeFileSync(runtimeFile, JSON.stringify(runtime.urls, null, 2));
  console.log(
    `RASUN local stack ready: DApp port ${ports.dapp}, admin ${ports.admin}, API ${ports.api}, local chain ${ports.chain}.`,
  );
  console.log(
    `DApp: ${runtime.urls.dapp}\nAdmin: ${runtime.urls.admin}\nAPI: ${runtime.urls.api}\nLocal RPC: ${runtime.urls.chain}`,
  );
  console.log(
    `Local-only seeded accounts, test oracle and sample rewards. Logs: ${runtime.urls.logs}. Ctrl+C stops only this run's services.`,
  );
} catch (error) {
  console.error(error.message);
  close(1);
}
