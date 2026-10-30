import net from "node:net";

async function listening(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(250, () => finish(true));
    socket.once("connect", () => finish(true));
    socket.once("error", (error) =>
      finish(
        ![
          "ECONNREFUSED",
          "EAFNOSUPPORT",
          "EADDRNOTAVAIL",
          "ENETUNREACH",
        ].includes(error.code),
      ),
    );
  });
}

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
        // Probe both loopback families: Windows may bind an IPv6-only default socket.
        if (
          (await listening("127.0.0.1", port)) ||
          (await listening("::1", port))
        )
          continue;
        const server = net.createServer();
        try {
          await new Promise((resolve, reject) => {
            server.once("error", reject);
            server.listen({ port, host: "0.0.0.0", exclusive: true }, resolve);
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

/** A port can be stolen after releasing a reservation; retry real bind failures only. */
export async function retryPort(
  initial,
  start,
  { attempts = 8, onRetry = () => {} } = {},
) {
  let port = initial;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return { port, value: await start(port) };
    } catch (error) {
      if (
        !["EADDRINUSE", "EACCES"].includes(error.code) ||
        attempt === attempts - 1
      )
        throw error;
      const reservation = await reserveDevPorts({ retry: port + 1 });
      port = reservation.retry;
      await reservation.release();
      onRetry(port, error);
    }
  }
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
