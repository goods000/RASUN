require("../../../contracts/node_modules/ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", moduleResolution: "node" },
});
const { test } = require("node:test");
const assert = require("node:assert/strict");
let WalletSession;
try {
  ({ WalletSession } = require("../src/lib/wallet.ts"));
} catch {}
function provider() {
  const listeners = {};
  return {
    listeners,
    on: (n, f) => (listeners[n] = f),
    removeListener: (n) => delete listeners[n],
    request: async ({ method }) =>
      method === "eth_requestAccounts"
        ? ["0x1111111111111111111111111111111111111111"]
        : method === "eth_chainId"
          ? "0x7a69"
          : null,
  };
}
test("connects and updates identity on account/chain change", async () => {
  assert.equal(typeof WalletSession, "function");
  const p = provider();
  const s = new WalletSession(p);
  await s.connect();
  assert.equal(s.chainId, 31337);
  assert.match(s.account, /^0x111/);
  const v = s.version;
  p.listeners.accountsChanged(["0x2222222222222222222222222222222222222222"]);
  assert.match(s.account, /^0x222/);
  assert.ok(s.version > v);
  p.listeners.chainChanged("0x61");
  assert.equal(s.chainId, 97);
  assert.throws(() => s.assertReady(31337), /WRONG_NETWORK/);
  s.dispose();
  assert.equal(Object.keys(p.listeners).length, 0);
});
test("rejects provider absence and clears state on disconnect", async () => {
  assert.equal(typeof WalletSession, "function");
  const no = new WalletSession(null);
  await assert.rejects(() => no.connect(), /NO_WALLET/);
  const p = provider();
  const s = new WalletSession(p);
  await s.connect();
  p.listeners.disconnect();
  assert.equal(s.account, "");
  assert.throws(() => s.assertReady(31337), /CONNECT_FIRST/);
});
test("does not restore an obsolete account when a connection request resolves late", async () => {
  assert.equal(typeof WalletSession, "function");
  const p = provider();
  let resolve;
  p.request = async ({ method }) =>
    method === "eth_requestAccounts"
      ? await new Promise((r) => (resolve = r))
      : "0x7a69";
  const s = new WalletSession(p);
  const connecting = s.connect();
  p.listeners.accountsChanged(["0x2222222222222222222222222222222222222222"]);
  resolve(["0x1111111111111111111111111111111111111111"]);
  await connecting;
  assert.match(s.account, /^0x222/);
});

test("authorization events before request resolution still initialize the chain", async () => {
  const p = provider();
  const s = new WalletSession(p);
  p.request = async ({ method }) => {
    if (method === "eth_requestAccounts") {
      p.listeners.accountsChanged([
        "0x1111111111111111111111111111111111111111",
      ]);
      return ["0x1111111111111111111111111111111111111111"];
    }
    return "0x7a69";
  };
  await s.connect();
  assert.equal(s.chainId, 31337);
  s.dispose();
});
test("final transaction boundary blocks a changed chain even without a wallet event", async () => {
  const p = provider();
  let chain = "0x7a69",
    sent = 0;
  const user = "0x1111111111111111111111111111111111111111";
  p.request = async ({ method }) => {
    if (method === "eth_requestAccounts" || method === "eth_accounts")
      return [user];
    if (method === "eth_chainId") return chain;
    if (method === "eth_sendTransaction") {
      sent++;
      return "hash";
    }
  };
  const s = new WalletSession(p);
  await s.connect();
  assert.equal(typeof s.guardedProvider, "function");
  const guarded = s.guardedProvider(31337, s.version, user);
  chain = "0x61";
  await assert.rejects(
    () =>
      guarded.request({
        method: "eth_sendTransaction",
        params: [{ from: user, to: user }],
      }),
    /WRONG_NETWORK|WALLET_CHANGED/,
  );
  assert.equal(sent, 0);
  s.dispose();
});
test("transaction boundary pins chainId and invalidates changed generations", async () => {
  const p = provider();
  let tx;
  const user = "0x1111111111111111111111111111111111111111";
  p.request = async ({ method, params }) =>
    method === "eth_requestAccounts" || method === "eth_accounts"
      ? [user]
      : method === "eth_chainId"
        ? "0x7a69"
        : ((tx = params[0]), "hash");
  const s = new WalletSession(p);
  await s.connect();
  assert.equal(typeof s.guardedProvider, "function");
  const g = s.guardedProvider(31337, s.version, user);
  await g.request({
    method: "eth_sendTransaction",
    params: [{ from: user, to: user }],
  });
  assert.equal(tx.chainId, "0x7a69");
  p.listeners.accountsChanged(["0x2222222222222222222222222222222222222222"]);
  await assert.rejects(
    () =>
      g.request({
        method: "eth_sendTransaction",
        params: [{ from: user, to: user }],
      }),
    /WALLET_CHANGED/,
  );
  s.dispose();
});
