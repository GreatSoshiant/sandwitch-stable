import { maximumInput } from "../../src/lib/payment";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/rates", (route) =>
    route.fulfill({
      json: {
        usdPerEuro: 1.08,
        source: "Illustrative reference rate",
        live: false,
        updatedAt: null,
      },
    }),
  );
  await page.route("**/api/pool-quote?**", (route) => {
    const euros = BigInt(
      new URL(route.request().url()).searchParams.get("eurAmount")!,
    );
    const dollars = (euros * 108n + 99n) / 100n;
    return route.fulfill({
      json: {
        eurAmount: euros.toString(),
        usdcAmount: dollars.toString(),
        maxUsdcAmount: maximumInput(dollars).toString(),
        expiresAt: Date.now() + 30_000,
        source: "pool",
        chainId: 421614,
      },
    });
  });
  await page.goto("/");
});

test("complete preview: bad rate blocked, refreshed quote paid, activity and summary", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Explore the interactive demo" })
    .click();
  await expect(
    page.getByText("1,500.00", { exact: false }).first(),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `/private/tmp/tidewater-${test.info().project.name}-overview.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "New payment", exact: true }).click();
  const send = page.getByRole("button", {
    name: "Send €1,000.00",
    exact: true,
  });
  await expect(send).toBeEnabled();
  await expect(
    page.getByRole("region", { name: "Exchange rate comparison" }),
  ).toContainText("CoinGecko comparison is unavailable right now.");
  await send.click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Rate moved" }),
  ).toContainText(
    "Rate moved 0.5%, more than the 0.3% allowed. Nothing was sent.",
  );
  await expect(send).toBeDisabled();
  await page.getByRole("button", { name: "Refresh quote" }).click();
  await expect(send).toBeEnabled();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `/private/tmp/tidewater-${test.info().project.name}-payment.png`,
    fullPage: true,
  });
  await send.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText(
    "All steps in this preview are simulated.",
  );
  await expect(page.getByRole("dialog")).toContainText(
    "Uniswap v3 swap · simulated",
  );
  await expect(page.getByRole("dialog")).toContainText("1,080.00 tUSDC");
  await page
    .getByRole("button", { name: "View activity", exact: true })
    .click();
  await expect(
    page.getByText("Payment to Kessler", { exact: true }),
  ).toBeVisible();
  const swap = page
    .locator(".activity-row")
    .filter({ hasText: "USDC → EURC swap" });
  await expect(swap).toContainText("Uniswap v3 preview");
  await expect(swap).toContainText("1,080.00 tUSDC → 1,000.00 tEURC");
  await expect(swap).toContainText("Simulated");
  await page.getByRole("button", { name: "Swaps", exact: true }).click();
  await expect(swap).toBeVisible();
  await expect(
    page.getByText("Payment to Kessler", { exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `/private/tmp/tidewater-${test.info().project.name}-swap-activity.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Protected", exact: true }).click();
  await expect(
    page.getByText("Payment protected", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Payment to Kessler", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(
    page.getByText("420.00", { exact: false }).first(),
  ).toBeVisible();
  // No made-up blockchain receipt in preview.
  await expect(page.locator('a[href*="arbiscan.io/tx/"]')).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Explore the interactive demo" }),
  ).toBeVisible();
});

test("invalid inputs cannot send; layout fits the viewport", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Explore the interactive demo" })
    .click();
  await page.getByRole("button", { name: "New payment", exact: true }).click();
  await page.getByLabel("Your supplier receives").fill("-1");
  await expect(
    page.getByRole("alert").filter({ hasText: "Enter a euro amount" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send payment", exact: true }).last(),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("shows a fresh CoinGecko benchmark for the same payment amount", async ({
  page,
}) => {
  await page.route("**/api/rates", (route) =>
    route.fulfill({
      json: {
        usdPerEuro: 1.09945,
        usdPerUsdc: 0.9995,
        usdcPerEuro: 1.1,
        live: true,
        source: "CoinGecko · EURC/USDC reference",
        updatedAt: Date.now(),
      },
    }),
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Explore the interactive demo" })
    .click();
  await page.getByRole("button", { name: "New payment", exact: true }).click();
  const comparison = page.getByRole("region", {
    name: "Exchange rate comparison",
  });
  await expect(comparison).toContainText("1.0800");
  await expect(comparison).toContainText("Onchain quote");
  await expect(
    comparison.getByRole("row", { name: "Uniswap pool quote" }),
  ).toContainText("1,080.00");
  const benchmark = comparison.getByRole("row", {
    name: "CoinGecko reference",
  });
  await expect(benchmark).toContainText("1,100.00");
  await expect(comparison).toContainText("Updated just now");
  await page.getByLabel("Your supplier receives").fill("100");
  await expect(benchmark).toContainText("110.00");
  await expect(
    comparison.getByRole("row", { name: "Uniswap pool quote" }),
  ).toContainText("108.00");
  await expect(comparison).toContainText(
    "Live pool pricing · preview payments stay simulated.",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `/private/tmp/tidewater-rate-comparison-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test("an unavailable Uniswap quote never falls back to CoinGecko", async ({
  page,
}) => {
  await page.route("**/api/rates", (route) =>
    route.fulfill({
      json: {
        usdPerEuro: 1.1,
        usdPerUsdc: 1,
        usdcPerEuro: 1.1,
        live: true,
        source: "CoinGecko · EURC/USDC reference",
        updatedAt: Date.now(),
      },
    }),
  );
  await page.route("**/api/pool-quote?**", (route) =>
    route.fulfill({ status: 503, json: { error: "Uniswap unavailable" } }),
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Explore the interactive demo" })
    .click();
  await page.getByRole("button", { name: "New payment", exact: true }).click();
  const comparison = page.getByRole("region", {
    name: "Exchange rate comparison",
  });
  await expect(
    comparison.getByRole("row", { name: "Uniswap pool quote" }),
  ).toContainText("—");
  await expect(comparison).toContainText(
    "Market reference: 1 EURC ≈ 1.1000 USDC",
  );
  await expect(
    page.getByRole("alert").filter({ hasText: "Uniswap quote is unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send payment", exact: true }).last(),
  ).toBeDisabled();
});
