import { test, expect } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { createPublicClient, http, erc20Abi, type Address } from "viem";
import { arbitrumSepolia } from "viem/chains";

test("lost broadcast response survives reload without a duplicate payment", async ({
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
    await page
      .getByRole("button", { name: "Create a new account", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Good things cross borders." }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Add 1,500 test USDC" }).click();
    await expect(page.locator(".balance-number")).toContainText("1,500.00");
    const client = createPublicClient({
      chain: arbitrumSepolia,
      transport: http(process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL),
    });
    const readSupplier = () =>
      client.readContract({
        address: process.env.NEXT_PUBLIC_EURC_ADDRESS as Address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [process.env.NEXT_PUBLIC_SUPPLIER_ADDRESS as Address],
      });
    const before = await readSupplier();
    let forwards = 0;
    await page.route(
      process.env.NEXT_PUBLIC_ZERODEV_RPC_URL!,
      async (route) => {
        const body = route.request().postDataJSON();
        if (body?.method !== "eth_sendUserOperation") {
          await route.continue();
          return;
        }
        if (forwards === 0) {
          forwards++;
          await route.fetch();
        } // Server receives it; browser loses the reply.
        await route.abort("failed");
      },
    );
    await page
      .getByRole("button", { name: "New payment", exact: true })
      .click();
    await page.getByLabel("Your supplier receives").fill("10");
    await expect(
      page.getByRole("button", { name: "Send €10.00", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Send €10.00", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Check operation status", exact: true }),
    ).toBeEnabled();
    const pending = await page.evaluate(() =>
      Object.entries(localStorage).filter(([k]) =>
        k.startsWith("tidewater:pending:"),
      ),
    );
    expect(pending).toHaveLength(1);
    const record = JSON.parse(pending[0][1]);
    await page.unroute(process.env.NEXT_PUBLIC_ZERODEV_RPC_URL!);
    await page.reload();
    await page
      .getByRole("button", { name: "Sign in with a passkey", exact: false })
      .click();
    await expect(
      page.getByRole("button", { name: "Check operation status", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Check operation status", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Check operation status", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Activity", exact: true }).click();
    await expect(
      page.getByText("Payment confirmed", { exact: true }),
    ).toBeVisible();
    expect((await readSupplier()) - before).toBe(10_000_000n);
    expect(forwards).toBe(1);
    writeFileSync(
      "deployments/connection-loss-verification.json",
      JSON.stringify(
        {
          verifiedAt: new Date().toISOString(),
          url: page.url(),
          userOperationHash: record.hash,
          broadcastResponseLost: true,
          pendingRestoredAfterReload: true,
          statusCheckResolved: true,
          forwardedBroadcasts: forwards,
          supplierReceived: "10 tEURC exactly once",
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
