import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, http, parseAbi, type Address } from "viem";
import { arbitrumSepolia } from "viem/chains";

test("same-wallet backup recovery, one-payment session and real pool protection", async ({
  page,
  context,
}) => {
  test.setTimeout(480_000);
  page.setDefaultTimeout(30_000);
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
  page.on("console", (message) => {
    if (message.type() === "error")
      console.log(
        "Browser error:",
        message
          .text()
          .replace(/https?:\/\/[^\s]+/g, "[endpoint]")
          .slice(0, 500),
      );
  });
  page.on("requestfailed", (request) => {
    let method = "";
    try {
      method = request.postDataJSON()?.method || "";
    } catch {}
    console.log("Request failed:", method, request.failure()?.errorText);
  });
  page.on("response", async (response) => {
    if (response.status() >= 400) {
      try {
        const body = await response.json();
        const msg =
          body.error?.message ||
          body.message ||
          (typeof body.error === "string" ? body.error : "");
        let method = "";
        try {
          method = response.request().postDataJSON()?.method || "";
        } catch {}
        console.log(
          "Rejected request:",
          response.status(),
          method,
          new URL(response.url()).hostname,
        );
        if (msg)
          console.log(
            "ZeroDev error:",
            String(msg)
              .replace(/https?:\/\/[^\s]+/g, "[endpoint]")
              .slice(0, 600),
          );
      } catch {}
    }
  });
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
    const primary = (
      await cdp.send("WebAuthn.getCredentials", { authenticatorId })
    ).credentials;
    await page
      .getByRole("button", { name: "Account & security", exact: true })
      .click();
    const address = await page.locator(".account-address").first().innerText();
    await page.getByRole("checkbox").check();
    const downloaded = page.waitForEvent("download", { timeout: 60_000 });
    await page
      .getByRole("button", { name: "Add a backup passkey", exact: true })
      .click();
    const file = await Promise.race([
      downloaded,
      page
        .locator(".alert.error")
        .first()
        .waitFor({ state: "visible", timeout: 60_000 })
        .then(async () => {
          throw new Error(
            await page.locator(".alert.error").first().innerText(),
          );
        }),
    ]);
    console.log("PASS: backup activated on the original wallet.");
    const payload = readFileSync((await file.path())!, "utf8");
    const kit = JSON.parse(payload);
    expect(kit.account).toBe(address);
    expect(payload).not.toContain("privateKey");
    await expect(
      page.getByRole("button", { name: "Remove backup", exact: true }),
    ).toBeEnabled();
    const all = (await cdp.send("WebAuthn.getCredentials", { authenticatorId }))
      .credentials;
    const backup = all.filter(
      (c) => !primary.some((p) => p.credentialId === c.credentialId),
    );
    expect(backup).toHaveLength(1);
    for (const credential of primary)
      await cdp.send("WebAuthn.removeCredential", {
        authenticatorId,
        credentialId: credential.credentialId,
      });
    await page
      .getByRole("button", { name: "PR Priya Raman Raman Home", exact: true })
      .click();
    await page.evaluate(() => localStorage.clear());
    await page
      .getByRole("button", {
        name: "Recover with a backup passkey",
        exact: true,
      })
      .click();
    await page.getByLabel("Import recovery file").setInputFiles({
      name: "recovery.json",
      mimeType: "application/json",
      buffer: Buffer.from(payload),
    });
    await expect(
      page.getByRole("heading", { name: "Good things cross borders." }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Account & security", exact: true })
      .click();
    await expect(page.locator(".account-address").first()).toHaveText(address);
    await expect(
      page.getByText("Signed in with your backup passkey.", { exact: false }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Send payment", exact: true })
      .first()
      .click();
    console.log(
      "PASS: recovery file and backup passkey restored the original wallet.",
    );
    await page.getByLabel("Your supplier receives").fill("10");
    await expect(
      page.getByRole("button", { name: "Send €10.00", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Send €10.00", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Delivered. Just like that." }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "View activity", exact: true })
      .click();
    await page
      .getByRole("button", { name: "PR Priya Raman Raman Home", exact: true })
      .click();
    for (const credential of backup)
      await cdp.send("WebAuthn.removeCredential", {
        authenticatorId,
        credentialId: credential.credentialId,
      });
    for (const credential of primary)
      await cdp.send("WebAuthn.addCredential", { authenticatorId, credential });
    await page
      .getByRole("button", { name: "Sign in with a passkey", exact: false })
      .click();
    await expect(
      page.getByRole("heading", { name: "Good things cross borders." }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Account & security", exact: true })
      .click();
    await expect(page.locator(".account-address").first()).toHaveText(address);
    await page
      .getByRole("button", { name: "Enable limited session", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "End payment session", exact: true }),
    ).toBeEnabled();
    console.log("PASS: session approved by the primary passkey.");
    const before = (
      await cdp.send("WebAuthn.getCredentials", { authenticatorId })
    ).credentials.map((c) => c.signCount);
    await page
      .getByRole("button", { name: "Send payment", exact: true })
      .first()
      .click();
    await page.getByLabel("Your supplier receives").fill("1000");
    await expect(
      page.getByRole("button", { name: "Send €1,000.00", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Send €1,000.00", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Delivered. Just like that." }),
    ).toBeVisible();
    expect(
      (
        await cdp.send("WebAuthn.getCredentials", { authenticatorId })
      ).credentials.map((c) => c.signCount),
    ).toEqual(before);
    await page
      .getByRole("button", { name: "View activity", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Account & security", exact: true })
      .click();
    console.log(
      "PASS: limited-session payment completed without an extra passkey prompt.",
    );
    await page
      .getByRole("button", { name: "End payment session", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Enable limited session", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", {
        name: "Run live rate-protection demo",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Run live rate-protection demo",
        exact: true,
      }),
    ).toBeEnabled({ timeout: 150_000 });
    const errors = await page.locator(".alert.error").allTextContents();
    expect(errors, errors.join("; ")).toEqual([]);
    await page.getByRole("button", { name: "Activity", exact: true }).click();
    for (const title of [
      "Test pool price changed",
      "Rate protection verified",
      "Test pool restored",
    ])
      await expect(page.getByText(title, { exact: true })).toBeVisible();
    expect(
      await page.locator('a[href*="arbiscan.io/tx/"]').count(),
    ).toBeGreaterThanOrEqual(4);
    await page
      .getByRole("button", { name: "Account & security", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Remove backup", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Remove backup", exact: true }),
    ).toHaveCount(0);
    const chain = createPublicClient({
      chain: arbitrumSepolia,
      transport: http(process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL),
    });
    expect(
      await chain.readContract({
        address: address as Address,
        abi: parseAbi([
          "function isModuleInstalled(uint256,address,bytes) view returns(bool)",
        ]),
        functionName: "isModuleInstalled",
        args: [1n, kit.permissionId, "0x"],
      }),
    ).toBe(false);
    await page.getByRole("button", { name: "Activity", exact: true }).click();
    const confirmedTransactions = await page
      .locator(".activity-row")
      .evaluateAll((rows) =>
        rows.flatMap((row) => {
          const link = row.querySelector<HTMLAnchorElement>(
            'a[href*="arbiscan.io/tx/"]',
          );
          return link
            ? [
                {
                  title: row.querySelector("b span")?.textContent,
                  url: link.href,
                },
              ]
            : [];
        }),
      );
    writeFileSync(
      "deployments/security-verification.json",
      JSON.stringify(
        {
          verifiedAt: new Date().toISOString(),
          url: page.url(),
          account: address,
          backupSameAddress: true,
          backupPayment: true,
          backupRevoked: true,
          recoveryFileHasNoPrivateKey: true,
          limitedPaymentWithoutExtraPasskeyPrompt: true,
          sessionRevoked: true,
          livePoolPriceChangedAndRestored: true,
          confirmedTransactions,
          protectionCheck:
            "actual contract simulation rejected the old capped invoice; no failing invoice broadcast",
          device:
            "Chromium virtual WebAuthn authenticator; physical devices still need manual checks",
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
