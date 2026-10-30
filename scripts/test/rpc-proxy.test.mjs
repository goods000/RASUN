import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import rpc from "../rpc-provider.cjs";
test("ethers RPC uses explicit HTTP proxy CONNECT for external hosts and bypasses loopback", async () => {
  const target = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end('{"jsonrpc":"2.0","id":1,"result":"0x61"}');
  });
  const proxy = http.createServer();
  let connects = 0;
  const sockets = new Set();
  proxy.on("connect", (req, socket, head) => {
    connects++;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    const upstream = net.connect(target.address().port, "127.0.0.1", () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
    sockets.add(upstream);
    upstream.on("close", () => sockets.delete(upstream));
  });
  await new Promise((r) => target.listen(0, "127.0.0.1", r));
  await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
  try {
    const settings = { HTTP_PROXY: `http://127.0.0.1:${proxy.address().port}` };
    const request = rpc.rpcRequest("http://rpc-test.invalid", settings);
    request.timeout = 2000;
    const response = await request.send();
    assert.equal(JSON.parse(response.bodyText).result, "0x61");
    assert.equal(connects, 1);
    const direct = rpc.rpcRequest(
      `http://127.0.0.1:${target.address().port}`,
      settings,
    );
    assert.equal(JSON.parse((await direct.send()).bodyText).result, "0x61");
    assert.equal(connects, 1);
  } finally {
    for (const s of sockets) s.destroy();
    await Promise.all([
      new Promise((r) => target.close(r)),
      new Promise((r) => proxy.close(r)),
    ]);
  }
});
