import net from "node:net";

/** Hold both ports until the launcher is ready to start the UI servers. */
export async function reserveUiPorts(dappStart = 5173, adminStart = 5174) {
  const held = [];
  async function reserve(start) {
    if (!Number.isInteger(start) || start < 1 || start > 65535)
      throw Error("Invalid UI port");
    for (let port = start; port <= Math.min(start + 127, 65535); port++) {
      const server = net.createServer();
      try {
        await new Promise((resolve, reject) => {
          server.once("error", reject);
          server.listen({ port, exclusive: true }, resolve);
        });
        held.push(server);
        server.unref();
        return port;
      } catch (error) {
        if (!["EADDRINUSE", "EACCES"].includes(error.code)) throw error;
      }
    }
    throw Error("No available UI port near " + start);
  }
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    await Promise.all(
      held.map((server) => new Promise((resolve) => server.close(resolve))),
    );
  };
  try {
    return {
      dapp: await reserve(dappStart),
      admin: await reserve(adminStart),
      release,
    };
  } catch (error) {
    await release();
    throw error;
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
