import { test, expect } from "@playwright/test";
test("admin reports real supply and searchable users without write controls", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5174");
  await expect(page.getByTestId("admin-supply")).not.toHaveText("—");
  await page.getByRole("button", { name: "用户与排名", exact: true }).click();
  await expect(
    page.getByRole("columnheader", { name: "钱包地址" }),
  ).toBeVisible();
  await page.getByPlaceholder("输入钱包地址查询").fill("bad");
  await page.getByRole("button", { name: "查询钱包", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("有效");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/admin-mobile.png",
    fullPage: true,
  });
});

test("a delayed wallet response cannot overwrite the newer query", async ({
  page,
  request,
}) => {
  const cfg = await (
    await request.get("http://127.0.0.1:3000/api/config")
  ).json();
  const actual = await (
    await request.get("http://127.0.0.1:3000/api/wallet/" + cfg.demoWallet)
  ).json();
  const a = "0x1111111111111111111111111111111111111111",
    b = "0x2222222222222222222222222222222222222222";
  let releaseA: () => void;
  let completed: () => void;
  const completion = new Promise<void>((r) => (completed = r));
  await page.route("**/api/wallet/*", async (route) => {
    const address = route.request().url().split("/").pop();
    if (address === a) await new Promise<void>((r) => (releaseA = r));
    await route.fulfill({ json: { ...actual, address } });
    if (address === a) completed();
  });
  await page.goto("http://127.0.0.1:5174");
  await page.getByRole("button", { name: "用户与排名", exact: true }).click();
  await page.getByPlaceholder("输入钱包地址查询").fill(a);
  await page.getByRole("button", { name: "查询钱包", exact: true }).click();
  await expect.poll(() => Boolean(releaseA)).toBe(true);
  await page.getByPlaceholder("输入钱包地址查询").fill(b);
  await page.getByRole("button", { name: "查询钱包", exact: true }).click();
  await expect(page.locator(".wallet-identity")).toHaveText(b);
  releaseA!();
  await completion;
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(page.locator(".wallet-identity")).toHaveText(b);
});
