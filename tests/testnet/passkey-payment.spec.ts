import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  createPublicClient,
  erc20Abi,
  http,
  parseAbi,
  parseEventLogs,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { arbitrumSepolia } from "viem/chains";

test("real passkey account, sponsored funding, exact EURC delivery on Arbitrum Sepolia", async ({
  page,
  context,
}) => {
  test.skip(
    !process.env.NEXT_PUBLIC_ZERODEV_RPC_URL ||
      !process.env.NEXT_PUBLIC_ZERODEV_PASSKEY_SERVER_URL,
    "Configure the ZeroDev project first.",
  );
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
    const chain = createPublicClient({
      chain: arbitrumSepolia,
      transport: http(process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL),
    });
    const supplier = process.env.NEXT_PUBLIC_SUPPLIER_ADDRESS as Address;
    const euro = process.env.NEXT_PUBLIC_EURC_ADDRESS as Address;
    const balanceBefore = await chain.readContract({
      address: euro,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [supplier],
    });
    await page.goto("/");
    const registrationOptions = page.waitForResponse((response) =>
      response.url().endsWith("/register/options"),
    );
    await page.getByRole("button", { name: "Create a new account" }).click();
    const options = await (await registrationOptions).json();
    const relyingParty = options.options?.rp?.id as string | undefined;
    const hostname = new URL(page.url()).hostname;
    expect(
      Boolean(
        relyingParty &&
        (hostname === relyingParty || hostname.endsWith(`.${relyingParty}`)),
      ),
      `ZeroDev passkey domain must match ${hostname}; the server currently returns ${relyingParty || "no domain"}.`,
    ).toBe(true);
    await expect(
      page.getByRole("heading", { name: "Good things cross borders." }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Add 1,500 test USDC" }).click();
    await expect(
      page.getByText("1,500.00", { exact: false }).first(),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Account & security", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Enable limited session", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "End payment session", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    await page
      .getByRole("button", { name: "New payment", exact: true })
      .click();
    const send = page.getByRole("button", {
      name: "Send €1,000.00",
      exact: true,
    });
    await expect(send).toBeEnabled();
    await send.click();
    const summary = page.getByRole("dialog", {
      name: "Delivered. Just like that.",
    });
    await expect(summary).toBeVisible();
    await expect(summary).toContainText("tEURC delivered");
    const receipt = summary.getByRole("link", {
      name: "View swap & payment transaction",
    });
    await expect(receipt).toHaveAttribute(
      "href",
      /^https:\/\/sepolia\.arbiscan\.io\/tx\/0x[a-fA-F0-9]{64}$/,
    );
    const transactionUrl = await receipt.getAttribute("href");
    const transactionHash = transactionUrl!.split("/").at(-1) as Hex;
    const mined = await chain.getTransactionReceipt({ hash: transactionHash });
    const operationEvents = parseEventLogs({
      abi: parseAbi([
        "event UserOperationEvent(bytes32 indexed userOpHash,address indexed sender,address indexed paymaster,uint256 nonce,bool success,uint256 actualGasCost,uint256 actualGasUsed)",
      ]),
      logs: mined.logs,
    });
    const operation = operationEvents.find((event) => event.args.success);
    expect(operation).toBeDefined();
    expect(operation!.args.paymaster).not.toBe(zeroAddress);
    expect(await chain.getBalance({ address: operation!.args.sender })).toBe(
      0n,
    );
    const balanceAfter = await chain.readContract({
      address: euro,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [supplier],
    });
    expect(balanceAfter - balanceBefore).toBe(1_000_000_000n);
    mkdirSync("deployments", { recursive: true });
    const report = {
      chainId: 421614,
      appOrigin: new URL(page.url()).origin,
      checkedAt: new Date().toISOString(),
      transactionUrl,
      sender: operation!.args.sender,
      supplier,
      paymaster: operation!.args.paymaster,
      actualGasCostWei: operation!.args.actualGasCost.toString(),
      eurcDelivered: "1000",
      wallet: "ZeroDev Kernel 3.3 with a passkey owner",
      paymentAuthorization:
        "Passkey-approved, single-operation permission session",
      sponsorship:
        "EntryPoint success event has a nonzero paymaster; sender holds zero native ETH",
      returningLoginVerified: false,
      note: "Executed using a disposable browser virtual authenticator. No passkey credentials are saved in this report.",
    };
    await page.screenshot({
      path: "/private/tmp/tidewater-testnet-summary.png",
      fullPage: true,
    });
    await summary
      .getByRole("button", { name: "View activity", exact: true })
      .click();
    await expect(
      page.getByText("Payment to Kessler", { exact: true }),
    ).toBeVisible();
    const swap = page
      .locator(".activity-row")
      .filter({ hasText: "USDC → EURC swap" });
    await expect(swap).toContainText("Uniswap v3 · 0.01% pool");
    await expect(swap.locator("code")).toHaveText(transactionHash);
    await expect(
      swap.getByRole("link", { name: "View Uniswap swap transaction" }),
    ).toHaveAttribute("href", transactionUrl!);
    await expect(swap).toContainText("Same transaction as supplier payment");
    await page.screenshot({
      path: "/private/tmp/tidewater-live-swap-activity.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Swaps", exact: true }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "/private/tmp/tidewater-live-mobile-swap-activity.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page
      .getByRole("button", { name: "All activity", exact: true })
      .click();
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    const balanceText = await page.locator(".balance-number").textContent();
    await expect(
      page.getByRole("button", { name: "Add 1,500 test USDC" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "PR Priya Raman Raman Home", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Sign in with a passkey", exact: false })
      .click();
    await expect(
      page.getByRole("heading", { name: "Good things cross borders." }),
    ).toBeVisible();
    await expect(page.locator(".balance-number")).toHaveText(balanceText!);
    await page.getByRole("button", { name: "Activity", exact: true }).click();
    const restoredSwap = page
      .locator(".activity-row")
      .filter({ hasText: "USDC → EURC swap" });
    await expect(restoredSwap.locator("code")).toHaveText(transactionHash);
    await page
      .getByRole("button", { name: "Refresh payment history", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Refresh payment history",
        exact: true,
      }),
    ).toBeEnabled();
    await expect(restoredSwap).toHaveCount(1);
    report.returningLoginVerified = true;
    writeFileSync(
      "deployments/passkey-payment-verification.json",
      JSON.stringify(report, null, 2) + "\n",
    );
  } finally {
    await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
  }
});
