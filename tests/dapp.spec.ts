const apiBase = process.env.TEST_API_URL || "http://127.0.0.1:3000/api";
const rpcUrl = process.env.TEST_RPC_URL || "http://127.0.0.1:8545";
import { test, expect } from "@playwright/test";
let snapshot: string;
async function rpc(method: string, params: any[] = []) {
  const r = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return (await r.json()).result;
}
test.beforeAll(async () => {
  snapshot = await rpc("evm_snapshot");
});
test.afterAll(async () => {
  if (snapshot) await rpc("evm_revert", [snapshot]);
});
test("mobile and desktop show live economics, full translations and empty wallet state", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "让每一份持有" }),
  ).toBeVisible();
  await expect(page.getByTestId("minted")).toContainText("2,003,333");
  await expect(page.getByTestId("holding-claim")).toBeDisabled();
  await page.getByLabel("语言").selectOption("en");
  await expect(
    page.getByRole("heading", { name: "Turn your holdings" }),
  ).toBeVisible();
  for (const l of ["zh-TW", "ms", "ja", "ko", "ru", "zh-CN"]) {
    await page.locator("select").selectOption(l);
    await expect(page.getByTestId("holding-claim")).toBeVisible();
  }
  await page.screenshot({
    path: "test-results/dapp-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("holding-claim")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/dapp-mobile.png",
    fullPage: true,
  });
});
test("wallet rejection is visible and never pretends to connect", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).ethereum = {
      on() {},
      removeListener() {},
      async request() {
        throw Object.assign(Error("Rejected"), { code: 4001 });
      },
    };
  });
  await page.goto("/");
  await page.getByTestId("connect").click();
  await expect(page.getByRole("status")).toContainText("交易失败或已取消");
  await expect(page.getByTestId("holding-claim")).toBeDisabled();
});
test("real local wallet can bind inviter and claim only holding rewards", async ({
  page,
}) => {
  const config = await (await page.request.get(apiBase + "/config")).json();
  const user = config.demoWallet;
  await page.addInitScript(
    ({ user, rpcUrl }) => {
      const handlers: Record<string, Function> = {};
      (window as any).ethereum = {
        on(n: string, f: Function) {
          handlers[n] = f;
        },
        removeListener(n: string) {
          delete handlers[n];
        },
        async request({ method, params }: any) {
          if (method === "eth_requestAccounts" || method === "eth_accounts")
            return [user];
          const r = await fetch(rpcUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method,
              params: params || [],
            }),
          });
          const b = await r.json();
          if (b.error) throw Error(b.error.message);
          return b.result;
        },
      };
    },
    { user, rpcUrl },
  );
  await page.goto("/");
  await page.getByTestId("connect").click();
  await expect(page.getByTestId("holding-claim")).toBeEnabled();
  const before = await (
    await page.request.get(apiBase + "/wallet/" + user)
  ).json();
  await page.getByTestId("holding-claim").click();
  await expect(page.getByRole("status")).toContainText("交易已确认", {
    timeout: 30000,
  });
  const after = await (
    await page.request.get(apiBase + "/wallet/" + user)
  ).json();
  expect(after.claimable.holding).toBe("0");
  expect(after.claimable.referral).toBe(before.claimable.referral);
  await page.getByRole("button", { name: "推广挖矿", exact: true }).click();
  await page
    .getByTestId("inviter-input")
    .fill("0x0000000000000000000000000000000000000123");
  await page.getByTestId("bind").click();
  await expect(page.getByRole("status")).toContainText("交易已确认", {
    timeout: 30000,
  });
});

test("RPC error shows unavailable state and disables financial actions", async ({
  page,
}) => {
  await page.route("**/api/overview", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "RPC unavailable" }),
    }),
  );
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("链上数据暂不可用");
  await expect(page.getByTestId("holding-claim")).toBeDisabled();
});

test("switching chain during gas estimation never forwards an old transaction", async ({
  page,
  request,
}) => {
  const cfg = await (await request.get(apiBase + "/config")).json();
  await page.addInitScript(
    ({ user, rpcUrl }) => {
      let chain = "0x7a69";
      const listeners: Record<string, Function> = {};
      (window as any).sentTransactions = 0;
      (window as any).ethereum = {
        on(n: string, fn: Function) {
          listeners[n] = fn;
        },
        removeListener(n: string) {
          delete listeners[n];
        },
        async request({ method, params }: any) {
          if (method === "eth_accounts" || method === "eth_requestAccounts")
            return [user];
          if (method === "eth_chainId") return chain;
          if (method === "eth_sendTransaction")
            (window as any).sentTransactions++;
          const response = await fetch(rpcUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method,
              params: params || [],
            }),
          });
          const result = await response.json();
          if (result.error) throw Error(result.error.message);
          if (method === "eth_estimateGas") {
            chain = "0x61";
            listeners.chainChanged?.(chain);
          }
          return result.result;
        },
      };
    },
    { user: cfg.demoWallet, rpcUrl },
  );
  await page.goto("/");
  await page.getByTestId("connect").click();
  await expect(page.getByTestId("referral-claim")).toBeEnabled();
  await page.getByTestId("referral-claim").click();
  await expect(page.getByRole("status")).toContainText("钱包账户或网络已变化");
  expect(await page.evaluate(() => (window as any).sentTransactions)).toBe(0);
});

test("a wallet on an older local RPC gets the current RPC address without sending a transaction", async ({
  page,
  request,
}) => {
  const cfg = await (await request.get(apiBase + "/config")).json();
  await page.addInitScript(
    ({ user, rpcUrl, number }) => {
      (window as any).sentTransactions = 0;
      (window as any).ethereum = {
        on() {},
        removeListener() {},
        async request({ method, params }: any) {
          if (method === "eth_requestAccounts" || method === "eth_accounts")
            return [user];
          if (method === "eth_sendTransaction")
            (window as any).sentTransactions++;
          const response = await fetch(rpcUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method,
              params: params || [],
            }),
          });
          const data = await response.json();
          if (data.error) throw Error(data.error.message);
          if (
            method === "eth_getBlockByNumber" &&
            params[0] === "0x" + number.toString(16)
          )
            return { ...data.result, hash: "0x" + "00".repeat(32) };
          return data.result;
        },
      };
    },
    { user: cfg.demoWallet, rpcUrl, number: cfg.localIdentity.number },
  );
  await page.goto("/");
  await page.getByTestId("connect").click();
  await expect(page.getByTestId("referral-claim")).toBeEnabled();
  await page.getByTestId("referral-claim").click();
  await expect(page.getByRole("status")).toContainText(
    "钱包连接的是另一条本地链",
  );
  await expect(page.getByRole("status")).toContainText(cfg.rpcUrl);
  expect(await page.evaluate(() => (window as any).sentTransactions)).toBe(0);
});
