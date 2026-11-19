import { test, expect } from "@playwright/test";
import { writeFileSync } from "node:fs";

test("Uniswap is primary and CoinGecko compares the same payment without funding", async ({
  page,
  context,
}) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send(
    "WebAuthn.addVirtualAuthenticator",
    {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    },
  );
  try {
    await page.goto("/");
    const marketResponse = await page.request.get("/api/rates");
    const market = await marketResponse.json();
    expect(marketResponse.ok()).toBe(true);
    // Public provider availability is reported separately; controlled reference
    // data verifies comparisons against a real onchain pool quote below.
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
      .getByRole("button", { name: "Create a new account", exact: true })
      .click();
    const overview = page.getByRole("region", {
      name: "Exchange rate comparison",
    });
    await expect(overview).toContainText("Uniswap v3 payment rate");
    await expect(overview).toContainText("Onchain quote");
    await expect(
      overview.getByRole("row", { name: "CoinGecko reference" }),
    ).toContainText("1,100.00");
    await expect(overview).toContainText("0.01% pool fee and price impact");
    const costText = await overview
      .getByRole("row", { name: "Uniswap pool quote" })
      .getByRole("cell")
      .innerText();
    const cost = Number(costText.replaceAll(",", ""));
    const differenceLabel = overview.locator(".rate-difference b");
    if (await differenceLabel.count()) {
      const differenceText = await differenceLabel.innerText();
      expect(
        Math.abs(
          Number.parseFloat(differenceText.replaceAll(",", "")) -
            Math.abs(cost - 1100),
        ),
      ).toBeLessThan(0.02);
    } else expect(Math.abs(cost - 1100)).toBeLessThan(0.02);
    await overview.screenshot({
      path: "/private/tmp/tidewater-live-rate-overview.png",
    });
    await page
      .getByRole("button", { name: "New payment", exact: true })
      .click();
    await page.getByLabel("Your supplier receives").fill("100");
    const payment = page.getByRole("region", {
      name: "Exchange rate comparison",
    });
    await expect(
      payment.getByRole("row", { name: "CoinGecko reference" }),
    ).toContainText("110.00");
    await expect(payment).toContainText("Uniswap pool quote");
    await expect(
      page.getByText("0.3% above the Uniswap quote", { exact: true }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await payment.screenshot({
      path: "/private/tmp/tidewater-live-rate-mobile.png",
    });
    await page.route("**/api/rates", (route) =>
      route.fulfill({
        json: {
          usdPerEuro: 1.08,
          usdPerUsdc: null,
          usdcPerEuro: null,
          live: false,
          source: "Illustrative reference rate",
          updatedAt: null,
        },
      }),
    );
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.reload();
    await page
      .getByRole("button", { name: "Sign in with a passkey", exact: false })
      .click();
    const withoutReference = page.getByRole("region", {
      name: "Exchange rate comparison",
    });
    await expect(withoutReference).toContainText("Uniswap v3 payment rate");
    await expect(withoutReference).toContainText(
      "CoinGecko comparison is unavailable right now.",
    );
    await expect(
      withoutReference.getByRole("row", { name: "CoinGecko reference" }),
    ).toContainText("—");
    writeFileSync(
      "deployments/rate-comparison-verification.json",
      JSON.stringify(
        {
          verifiedAt: new Date().toISOString(),
          url: page.url(),
          poolQuote: "real Uniswap v3 on Arbitrum Sepolia",
          comparisonFixture: {
            usdcPerEuro: 1.1,
            for1000: "1100 USDC",
            for100: "110 USDC",
          },
          overviewAndPaymentVerified: true,
          amountAndPercentDifferenceUnitTested: true,
          mobileLayoutVerified: true,
          poolQuoteSurvivesMissingReference: true,
          publicCoinGeckoEndpoint: {
            live: market.live,
            source: market.source,
            updatedAt: market.updatedAt,
            usdcPerEuro: market.usdcPerEuro ?? null,
          },
          testFundsMinted: false,
          paymentSent: false,
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    await cdp
      .send("WebAuthn.removeVirtualAuthenticator", { authenticatorId })
      .catch(() => {});
  }
});
