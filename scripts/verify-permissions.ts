import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { createKernelAccount } from "@zerodev/sdk";
import { getEntryPoint, KERNEL_V3_3 } from "@zerodev/sdk/constants";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { encodeFunctionData, erc20Abi } from "viem";
import {
  makeWalletSession,
  fundTestAccount,
  sendPayment,
} from "../src/lib/wallet";
import { enableLimitedSession, removePermission } from "../src/lib/security";
import { paymentConfig, invoiceGateway } from "../src/lib/config";
import { publicClient, paymentCalls, getPoolQuote } from "../src/lib/chain";
import { safeDeploymentError } from "./lib/deployment-state";
// Disposable ECDSA owner isolates contract-policy tests from browser prompts.
// Neither temporary private key is persisted, logged or written to reports.
const storage = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
  },
});
async function main() {
  assert.ok(invoiceGateway);
  const signer = privateKeyToAccount(generatePrivateKey());
  const validator = await signerToEcdsaValidator(publicClient, {
    signer,
    entryPoint: getEntryPoint("0.7"),
    kernelVersion: KERNEL_V3_3,
  });
  const account = await createKernelAccount(publicClient, {
    plugins: { sudo: validator },
    entryPoint: getEntryPoint("0.7"),
    kernelVersion: KERNEL_V3_3,
  });
  const owner = makeWalletSession(
    account,
    validator,
    {
      pubX: 0n,
      pubY: 0n,
      authenticatorId: "",
      authenticatorIdHash: `0x${"00".repeat(32)}`,
      rpID: "",
    },
    "primary",
  );
  await fundTestAccount(owner);
  const limited = await enableLimitedSession(owner);
  const c = paymentConfig();
  const quote = await getPoolQuote(10_000_000n);
  const prepare = async (calls: ReturnType<typeof paymentCalls>) =>
    limited.wallet.client.prepareUserOperation({
      callData: await limited.wallet.account.encodeCalls(calls),
    });
  await prepare(paymentCalls(quote, limited.invoiceId));
  const rejected: string[] = [];
  async function reject(label: string, calls: ReturnType<typeof paymentCalls>) {
    let failure = "";
    try {
      await prepare(calls);
    } catch (error) {
      failure = String(error);
    }
    assert.match(
      failure,
      /revert|validation|policy|AA2|AA3/i,
      `${label} must fail contract validation, not a transport error`,
    );
    rejected.push(label);
    console.log(`PASS: ${label} rejected during operation validation.`);
  }
  await reject("arbitrary USDC recipient", [
    {
      to: c.usdc,
      value: 0n,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [signer.address, 1n],
      }),
    },
  ]);
  await reject("approval to another spender", [
    {
      to: c.usdc,
      value: 0n,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [signer.address, 1n],
      }),
    },
  ]);
  await reject("native ETH transfer", [
    { to: signer.address, value: 1n, data: "0x" },
  ]);
  await reject(
    "euro cap exceeded",
    paymentCalls({ ...quote, eurAmount: 1_000_000_001n }, limited.invoiceId),
  );
  await reject(
    "USDC cap exceeded",
    paymentCalls(
      { ...quote, maxUsdcAmount: 1_500_000_001n },
      limited.invoiceId,
    ),
  );
  await reject(
    "different invoice ID",
    paymentCalls(quote, `0x${"45".repeat(32)}`),
  );
  await reject(
    "deadline beyond permission expiry",
    paymentCalls(
      { ...quote, expiresAt: limited.expiresAt + 60_000 },
      limited.invoiceId,
    ),
  );
  const result = await sendPayment(
    limited.wallet,
    await getPoolQuote(10_000_000n),
    () => {},
    limited.invoiceId,
  );
  console.log("PASS: permitted supplier payment confirmed.");
  await reject(
    "second operation",
    paymentCalls(await getPoolQuote(10_000_000n), limited.invoiceId),
  );
  const revoked = await removePermission(
    owner,
    limited.permissionId,
    limited.wallet.validator,
  );
  assert.equal(
    await limited.wallet.validator.isEnabled(account.address, "0x"),
    false,
  );
  writeFileSync(
    "deployments/permission-verification.json",
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        chainId: 421614,
        owner:
          "disposable ECDSA owner for policy tests; browser passkeys tested separately",
        account: account.address,
        payment: result.hash,
        revocation: revoked,
        rejected,
        temporaryPrivateKeysSaved: false,
      },
      null,
      2,
    ) + "\n",
  );
}
main().catch((error) => {
  console.error(safeDeploymentError(error));
  if (error && typeof error === "object" && "details" in error)
    console.error(safeDeploymentError(new Error(String(error.details))));
  process.exitCode = 1;
});
