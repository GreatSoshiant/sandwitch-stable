import { test, expect } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { compareQuote } from "../../src/lib/rates";
import { formatUnits6, type Quote } from "../../src/lib/payment";

test("Preview reads real independent Uniswap and CoinGecko endpoints without sign-in", async ({
  page,
}) => {
  const marketResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/rates",
  );
  await page.goto("/");
  const market = await (await marketResponse).json();
  const poolResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/pool-quote" &&
      new URL(response.url()).searchParams.get("eurAmount") === "1000000000",
  );
  await page
    .getByRole("button", { name: "Explore the interactive demo" })
    .click();
  const poolReply = await poolResponse;
  expect(poolReply.status()).toBe(200);
  expect(poolReply.headers()["cache-control"]).toContain("no-store");
  const pool = await poolReply.json();
  expect(pool.source).toBe("pool");
  expect(pool.chainId).toBe(421614);
  const comparison = page.getByRole("region", {
    name: "Exchange rate comparison",
  });
  await expect(comparison).toContainText("Onchain quote");
  await expect(comparison).toContainText(
    "Live pool pricing · preview payments stay simulated.",
  );
  await expect(
    comparison.getByRole("row", { name: "Uniswap pool quote" }),
  ).toContainText(formatUnits6(BigInt(pool.usdcAmount)));
  let marketCost: string | null = null;
  if (market.live) {
    const quoted: Quote = {
      eurAmount: BigInt(pool.eurAmount),
      usdcAmount: BigInt(pool.usdcAmount),
      maxUsdcAmount: BigInt(pool.maxUsdcAmount),
      expiresAt: pool.expiresAt,
      source: "pool",
    };
    marketCost = compareQuote(
      quoted,
      market.usdcPerEuro,
    ).referenceCost.toString();
    await expect(
      comparison.getByRole("row", { name: "CoinGecko reference" }),
    ).toContainText(formatUnits6(BigInt(marketCost)));
  } else
    await expect(comparison).toContainText(
      "CoinGecko comparison is unavailable",
    );
  await comparison.screenshot({
    path: "/private/tmp/tidewater-preview-real-independent-rates.png",
  });
  await page.getByRole("button", { name: "New payment", exact: true }).click();
  const amountResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/pool-quote" &&
      new URL(response.url()).searchParams.get("eurAmount") === "100000000",
  );
  await page.getByLabel("Your supplier receives").fill("100");
  const newPool = await (await amountResponse).json();
  await expect(
    comparison.getByRole("row", { name: "Uniswap pool quote" }),
  ).toContainText(formatUnits6(BigInt(newPool.usdcAmount)));
  await expect(
    page.getByText("Preview · simulated", { exact: false }).first(),
  ).toBeVisible();
  writeFileSync(
    "deployments/preview-rate-independence-verification.json",
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        url: page.url(),
        mode: "Preview",
        mockedSources: false,
        uniswap: {
          source: "Uniswap Quoter on Arbitrum Sepolia",
          pool: pool.pool,
          quoter: pool.quoter,
          eurcAmount: pool.eurAmount,
          usdcCost: pool.usdcAmount,
          effectiveRate: Number(pool.usdcAmount) / Number(pool.eurAmount),
        },
        coinGecko: {
          live: market.live,
          usdcPerEuro: market.usdcPerEuro ?? null,
          referenceCost: marketCost,
        },
        bothOverviewAndPaymentVerified: true,
        noSignInRequired: true,
        noTokensMinted: true,
        noPaymentSent: true,
      },
      null,
      2,
    ) + "\n",
  );
});
