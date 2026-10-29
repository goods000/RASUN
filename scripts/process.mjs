import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
export const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const env = {
  ...process.env,
  XDG_CONFIG_HOME:
    process.env.XDG_CONFIG_HOME || path.join(root, ".local/config"),
  XDG_DATA_HOME: process.env.XDG_DATA_HOME || path.join(root, ".local/data"),
  XDG_CACHE_HOME: process.env.XDG_CACHE_HOME || path.join(root, ".local/cache"),
  PUPPETEER_SKIP_DOWNLOAD: "1",
};
export function command(args, options = {}) {
  const exec = process.env.npm_execpath;
  if (exec && /pnpm/.test(exec))
    return spawn(process.execPath, [exec, ...args], {
      cwd: root,
      env,
      stdio: "inherit",
      ...options,
    });
  return spawn(process.platform === "win32" ? "pnpm.cmd" : "pnpm", args, {
    cwd: root,
    env,
    stdio: "inherit",
    ...options,
  });
}
export async function run(args) {
  await new Promise((resolve, reject) => {
    const p = command(args);
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(Error(args.join(" ") + " exited " + code)),
    );
  });
}
export async function waitFor(url, check = () => true, timeout = 60000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (r.ok && check(await r.json())) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw Error("Readiness timed out: " + url);
}
export function stop(child) {
  if (!child?.pid) return;
  try {
    if (process.platform === "win32")
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    else process.kill(-child.pid, "SIGTERM");
  } catch {}
}

export async function assertFree(port) {
  await new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", () =>
      reject(
        Error(
          `Port ${port} already in use; stop the existing service before integration tests.`,
        ),
      ),
    );
    s.listen(port, "127.0.0.1", () => s.close(resolve));
  });
}
