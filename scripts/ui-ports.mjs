import net from "node:net";

export async function reserveDevPorts(
  preferred = { chain: 8545, api: 3000, dapp: 5173, admin: 5174 },
) {
  const held = new Map();
  const ports = {};
  async function release(name) {
    const names = name ? [name] : [...held.keys()];
    await Promise.all(
      names.map(async (key) => {
        const server = held.get(key);
        if (!server) return;
        held.delete(key);
        await new Promise((resolve) => server.close(resolve));
      }),
    );
  }
  try {
    for (const [name, start] of Object.entries(preferred)) {
      if (!Number.isInteger(start) || start < 1 || start > 65535)
        throw Error("Invalid development port");
      let found = false;
      for (let port = start; port <= Math.min(start + 127, 65535); port++) {
        const server = net.createServer();
        try {
          await new Promise((resolve, reject) => {
            server.once("error", reject);
            server.listen({ port, exclusive: true }, resolve);
          });
          held.set(name, server);
          server.unref();
          ports[name] = port;
          found = true;
          break;
        } catch (error) {
          if (!["EADDRINUSE", "EACCES"].includes(error.code)) throw error;
        }
      }
      if (!found) throw Error("No available development port near " + start);
    }
    return { ...ports, release };
  } catch (error) {
    await release();
    throw error;
  }
}
export function reserveUiPorts(dapp = 5173, admin = 5174) {
  return reserveDevPorts({ dapp, admin });
}

/** Dev-only middleware lets the launcher distinguish its child from an old UI. */
export function uiReadiness(
  application,
  runId = process.env.RASUN_DEV_RUN_ID || "",
) {
  return {
    name: "rasun-ui-readiness",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] !== "/__rasun_dev__") return next();
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify({ application, runId }));
      });
    },
  };
}
