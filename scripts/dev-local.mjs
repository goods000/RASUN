import { command, run, waitFor, stop, root } from "./process.mjs";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
const children = [];
let closing = false;
function close(code = 0) {
  if (closing) return;
  closing = true;
  process.exitCode = code;
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
function start(name, args) {
  const dir = path.join(root, ".local/logs");
  fs.mkdirSync(dir, { recursive: true });
  const fd = fs.openSync(path.join(dir, name + ".log"), "w");
  const child = command(args, {
    detached: process.platform !== "win32",
    stdio: ["ignore", fd, fd],
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
  for (const port of [8545, 3000, 5173, 5174]) await assertFree(port);
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
  start("api", ["--filter", "@rasun/api", "start"]);
  await waitFor(
    "http://127.0.0.1:3000/api/health",
    (h) => h.chain === "ready" && !h.index.error,
  );
  start("dapp", ["dev:dapp"]);
  start("admin", ["dev:admin"]);
  for (const port of [5173, 5174]) {
    const until = Date.now() + 60000;
    let up = false;
    while (Date.now() < until) {
      try {
        if (
          (
            await fetch(`http://127.0.0.1:${port}`, {
              signal: AbortSignal.timeout(1500),
            })
          ).ok
        ) {
          up = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 300));
    }
    if (!up) throw Error("UI failed to start on " + port);
  }
  console.log(
    "RASUN local stack ready: DApp port 5173, admin 5174, API 3000, local chain 8545.",
  );
  console.log(
    "Local-only seeded accounts, test oracle and sample rewards. Logs: .local/logs. Ctrl+C stops the services started by this command.",
  );
} catch (e) {
  console.error(e.message);
  close(1);
}
