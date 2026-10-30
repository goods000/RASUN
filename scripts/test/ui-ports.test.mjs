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

test("all four services skip occupied ports and can release reservations individually", async () => {
  const { reserveDevPorts } = await import("../ui-ports.mjs");
  assert.equal(typeof reserveDevPorts, "function");
  const occupied = await listener();
  const port = occupied.address().port;
  let held;
  try {
    held = await reserveDevPorts({
      chain: port,
      api: port,
      dapp: port,
      admin: port,
    });
    const values = ["chain", "api", "dapp", "admin"].map((k) => held[k]);
    assert.equal(new Set(values).size, 4);
    assert.ok(values.every((v) => v !== port));
    await held.release("chain");
    const server = net.createServer();
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(held.chain, resolve);
    });
    await close(server);
    assert.ok(occupied.listening);
  } finally {
    await held?.release();
    await close(occupied);
  }
});
test("concurrent local runs use different deployments and databases with matching endpoint configuration", async () => {
  const { localRuntime } = await import("../local-runtime.mjs").catch(
    () => ({}),
  );
  assert.equal(typeof localRuntime, "function");
  const ports = { chain: 8546, api: 3001, dapp: 5175, admin: 5176 };
  const a = localRuntime("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", ports),
    b = localRuntime("bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb", ports);
  assert.notEqual(a.urls.deployment, b.urls.deployment);
  assert.notEqual(a.environment.DATABASE_URL, b.environment.DATABASE_URL);
  assert.equal(a.environment.RPC_URL, "http://127.0.0.1:8546");
  assert.equal(a.environment.RASUN_API_URL, "http://127.0.0.1:3001");
  assert.equal(a.environment.PORT, "3001");
  assert.equal(a.environment.DEPLOYMENT_FILE, a.urls.deployment);
});

test("an IPv6-only default probe cannot hide an occupied IPv4 loopback port", async (t) => {
  const occupied = await listener("127.0.0.1");
  const port = occupied.address().port;
  let held;
  const listen = net.Server.prototype.listen;
  t.mock.method(net.Server.prototype, "listen", function (options, ...args) {
    if (
      typeof options === "object" &&
      options.port &&
      options.host === undefined
    )
      return listen.call(
        this,
        { ...options, host: "::1", ipv6Only: true },
        ...args,
      );
    return listen.call(this, options, ...args);
  });
  try {
    held = await reserveUiPorts(port, port);
    assert.notEqual(held.dapp, port, "the real IPv4 listener must be detected");
    assert.ok(occupied.listening);
  } finally {
    await held?.release();
    await close(occupied);
  }
});
test("a real bind collision after reservation release retries another port", async () => {
  const { retryPort } = await import("../ui-ports.mjs");
  assert.equal(typeof retryPort, "function");
  const occupied = await listener("127.0.0.1");
  const initial = occupied.address().port;
  let started;
  try {
    const result = await retryPort(initial, async (port) => {
      const server = net.createServer();
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", resolve);
      });
      return server;
    });
    started = result.value;
    assert.notEqual(result.port, initial);
    assert.ok(started.listening);
    assert.ok(occupied.listening);
  } finally {
    if (started) await close(started);
    await close(occupied);
  }
});
test("non-port startup failures are not retried", async () => {
  const { retryPort } = await import("../ui-ports.mjs");
  assert.equal(typeof retryPort, "function");
  let calls = 0;
  await assert.rejects(
    () =>
      retryPort(5000, async () => {
        calls++;
        throw Object.assign(Error("missing executable"), { code: "ENOENT" });
      }),
    { code: "ENOENT" },
  );
  assert.equal(calls, 1);
});
