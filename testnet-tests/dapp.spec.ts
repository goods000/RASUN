import { test, expect } from "@playwright/test";
const apiBase = process.env.TEST_API_URL || "http://127.0.0.1:3000/api";
const rpcUrl = process.env.TEST_RPC_URL || "http://127.0.0.1:8545";
let snapshot: string;
async function chainRpc(method: string, params: unknown[] = []) {
  const response = await fetch(rpcUrl, {
    signal: AbortSignal.timeout(15000),
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const result = await response.json();
  if (result.error) throw Error(result.error.message);
  return result.result;
}
test.beforeEach(async () => {
  if (Number(await chainRpc("eth_chainId")) !== 31337)
    throw Error(
      "Browser fixture tests require local chain31337, never public chain97",
    );
  snapshot = await chainRpc("evm_snapshot");
});
test.afterEach(async () => {
  if (snapshot) await chainRpc("evm_revert", [snapshot]);
});
test("sandbox labels, zero reward protection, real faucet and exact swap approvals", async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const config = await (await request.get(apiBase + "/config")).json();
  const accounts = await (
    await request.post(rpcUrl, {
      data: { jsonrpc: "2.0", id: 1, method: "eth_accounts", params: [] },
    })
  ).json();
  const user = accounts.result[8];
  await page.addInitScript(
    ({ user, rpcUrl }) => {
      localStorage.setItem("rasun-language", "en");
      (window as any).ethereum = {
        on() {},
        removeListener() {},
        async request({ method, params }: any) {
          if (method === "eth_requestAccounts" || method === "eth_accounts")
            return [user];
          if (method === "wallet_watchAsset") return true;
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
          const data = await r.json();
          if (data.error) throw Error(data.error.message);
          return data.result;
        },
      };
    },
    { user, rpcUrl },
  );
  await page.goto("/");
  await expect(page.getByTestId("sandbox-panel")).toBeVisible();
  await expect(page.getByTestId("sandbox-panel")).toContainText("tUSDT");
  await expect(page.getByTestId("sandbox-panel")).toContainText("PancakeSwap");
  await page.getByTestId("connect").click();
  await expect(page.getByTestId("holding-claim")).toBeDisabled();
  await expect(page.getByTestId("native-balance")).toContainText(
    config.chainId === 97 ? "tBNB" : "ETH",
  );
  await page.getByTestId("faucet-claim").click();
  await expect(page.getByRole("status")).toContainText(
    "Transaction confirmed",
    { timeout: 30000 },
  );
  await expect(page.getByTestId("quote-balance")).toContainText("1,000");
  await page.getByTestId("swap-amount").fill("1");
  await expect(page.getByTestId("swap-buy")).toBeEnabled();
  await page.getByTestId("swap-buy").click();
  await expect(page.getByRole("status")).toContainText(
    "Transaction confirmed",
    { timeout: 30000 },
  );
  const market = await (
    await request.get(apiBase + "/market?wallet=" + user)
  ).json();
  expect(BigInt(market.quoteBalance)).toBe(999n * 10n ** 18n);
  expect(market.allowances.quote).toBe("0");
  await page.getByTestId("swap-sell").click();
  await expect(page.getByRole("status")).toContainText(
    "Transaction confirmed",
    { timeout: 30000 },
  );
  const after = await (
    await request.get(apiBase + "/market?wallet=" + user)
  ).json();
  expect(BigInt(after.quoteBalance)).toBeGreaterThan(
    BigInt(market.quoteBalance),
  );
  expect(after.allowances.token).toBe("0");
  // Real fixture clock and real on-chain settlement; never mock rewards.
  await chainRpc("evm_increaseTime", [Number(config.epochSeconds) * 2]);
  await chainRpc("evm_mine");
  await page.reload();
  await page.getByTestId("connect").click();
  for (let batch = 0; batch < 20; batch++) {
    const overview = await (await request.get(apiBase + "/overview")).json();
    if (BigInt(overview.nextDay) >= BigInt(overview.currentDay)) break;
    const action =
      BigInt(overview.activeDay) === 0n
        ? "settlement-begin"
        : "settlement-process";
    await expect(page.getByTestId(action)).toBeEnabled();
    await page.getByTestId(action).click();
    await expect(page.getByRole("status")).toContainText(
      "Transaction confirmed",
      { timeout: 30000 },
    );
  }
  const beforeClaim = await (
    await request.get(apiBase + "/wallet/" + user)
  ).json();
  expect(BigInt(beforeClaim.claimable.holding)).toBeGreaterThan(0n);
  await expect(page.getByTestId("holding-claim")).toBeEnabled();
  await page.getByTestId("holding-claim").click();
  await expect(page.getByRole("status")).toContainText(
    "Transaction confirmed",
    { timeout: 30000 },
  );
  const afterClaim = await (
    await request.get(apiBase + "/wallet/" + user)
  ).json();
  expect(BigInt(afterClaim.balance)).toBe(
    BigInt(beforeClaim.balance) + BigInt(beforeClaim.claimable.holding),
  );
  expect(afterClaim.claimable.holding).toBe("0");
});

test("missing API never labels an unknown network as BSC and market failure disables sends", async ({
  page,
}) => {
  await page.route("**/api/config", (route) =>
    route.fulfill({ status: 503, body: "{}", contentType: "application/json" }),
  );
  await page.goto("/");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator(".network-strip")).not.toContainText("BSC TESTNET");
  await expect(page.getByTestId("holding-claim")).toBeDisabled();
});

test("all seven sandbox translations render and controls keep readable type", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("sandbox-panel")).toBeVisible();
  for (const locale of ["zh-CN", "zh-TW", "en", "ms", "ja", "ko", "ru"]) {
    await page.locator("select").selectOption(locale);
    await expect(page.getByTestId("sandbox-panel")).toContainText(
      "PancakeSwap",
    );
    expect(
      await page
        .getByTestId("faucet-claim")
        .evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize)),
    ).toBeGreaterThanOrEqual(14);
  }
});
