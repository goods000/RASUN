import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import http from "node:http";
const { reserveUiPorts, uiReadiness } = await import("../ui-ports.mjs").catch(
  () => ({}),
);
async function listener(host) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ port: 0, ...(host ? { host } : {}) }, resolve);
  });
  return server;
}
const close = (server) => new Promise((resolve) => server.close(resolve));
test("occupied UI ports are skipped without stopping their existing listener", async () => {
  assert.equal(typeof reserveUiPorts, "function");
  const occupied = await listener();
  const port = occupied.address().port;
  let reserved;
  try {
    reserved = await reserveUiPorts(port, port);
    assert.notEqual(reserved.dapp, port);
    assert.notEqual(reserved.admin, port);
    assert.notEqual(reserved.dapp, reserved.admin);
    assert.ok(occupied.listening);
    const check = net.createServer();
    await assert.rejects(
      () =>
        new Promise((resolve, reject) => {
          check.once("error", reject);
          check.listen(reserved.dapp, resolve);
        }),
      { code: "EADDRINUSE" },
    );
  } finally {
    await reserved?.release();
    await close(occupied);
  }
});
test("released UI reservations can actually be bound by their Vite servers", async () => {
  assert.equal(typeof reserveUiPorts, "function");
  const initial = await listener();
  const port = initial.address().port;
  await close(initial);
  const reserved = await reserveUiPorts(port, port);
  await reserved.release();
  const server = net.createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(reserved.dapp, resolve);
    });
    assert.ok(server.listening);
  } finally {
    await close(server);
  }
});
test("readiness identifies the newly started application rather than an old HTTP server", async () => {
  assert.equal(typeof uiReadiness, "function");
  let middleware;
  uiReadiness("dapp", "this-run").configureServer({
    middlewares: {
      use(fn) {
        middleware = fn;
      },
    },
  });
  const server = http.createServer((req, res) =>
    middleware(req, res, () => {
      res.writeHead(404);
      res.end();
    }),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = "http://127.0.0.1:" + server.address().port;
    const r = await fetch(base + "/__rasun_dev__");
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), {
      application: "dapp",
      runId: "this-run",
    });
    assert.equal((await fetch(base + "/other")).status, 404);
  } finally {
    await close(server);
  }
});
