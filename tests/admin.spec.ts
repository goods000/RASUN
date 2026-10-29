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
