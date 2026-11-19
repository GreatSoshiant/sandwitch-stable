import {
  createKernelAccount,
  createKernelAccountClient,
  createZeroDevPaymasterClient,
} from "@zerodev/sdk";
import { KERNEL_V3_3, getEntryPoint } from "@zerodev/sdk/constants";
import {
  toPasskeyValidator,
  toWebAuthnKey,
  WebAuthnMode,
  PasskeyValidatorContractVersion,
} from "@zerodev/passkey-validator";
import {
  erc20Abi,
  encodeFunctionData,
  http,
  parseAbi,
  parseEventLogs,
} from "viem";
import { arbitrumSepolia } from "viem/chains";
import {
  publicClient,
  paymentCalls,
  readBalance,
  verifyDeployment,
} from "./chain";
import {
  passkeyServer,
  zeroDevRpc,
  walletConfigured,
  paymentConfig,
} from "./config";
import { validatePayment, type Quote } from "./payment";
import { INITIAL_BALANCE } from "./payment";
import { submitOperation, type OperationReceipt } from "./operations";
import type { KernelValidator } from "@zerodev/sdk";

export async function connectPasskey(register = false) {
  if (!walletConfigured)
    throw new Error(
      "Set the ZeroDev RPC and passkey server URLs to enable passkey sign-in.",
    );
  const webAuthnKey = await toWebAuthnKey({
    passkeyName: "Priya · Tidewater Pay",
    passkeyServerUrl: passkeyServer,
    mode: register ? WebAuthnMode.Register : WebAuthnMode.Login,
    passkeyServerHeaders: {},
  });
  if (!register) {
    const { restoreKnownPasskey } = await import("./security");
    const restored = await restoreKnownPasskey(webAuthnKey);
    if (restored) return restored;
  }
  const entryPoint = getEntryPoint("0.7");
  const validator = await toPasskeyValidator(publicClient, {
    webAuthnKey,
    entryPoint,
    kernelVersion: KERNEL_V3_3,
    validatorContractVersion: PasskeyValidatorContractVersion.V0_0_3_PATCHED,
  });
  const account = await createKernelAccount(publicClient, {
    plugins: { sudo: validator },
    entryPoint,
    kernelVersion: KERNEL_V3_3,
  });
  return makeWalletSession(account, validator, webAuthnKey, "primary");
}

export function makeWalletSession(
  account: Awaited<
    ReturnType<typeof createKernelAccount<"0.7", typeof KERNEL_V3_3>>
  >,
  validator: KernelValidator,
  webAuthnKey: Awaited<ReturnType<typeof toWebAuthnKey>>,
  access: "primary" | "backup",
) {
  const paymaster = createZeroDevPaymasterClient({
    chain: arbitrumSepolia,
    transport: http(zeroDevRpc),
  });
  const client = createKernelAccountClient({
    account,
    chain: arbitrumSepolia,
    client: publicClient,
    bundlerTransport: http(zeroDevRpc),
    paymaster: {
      getPaymasterData: (operation) =>
        paymaster.sponsorUserOperation({ userOperation: operation }),
    },
  });
  return { account, client, validator, webAuthnKey, access };
}

export type WalletSession = ReturnType<typeof makeWalletSession>;

export async function fundTestAccount(session: WalletSession) {
  if (process.env.NEXT_PUBLIC_ENABLE_TEST_FAUCET !== "true")
    throw new Error(
      "Fund this account with test USDC from your configured faucet.",
    );
  const config = await verifyDeployment();
  const receipt = await submitOperation(
    session,
    await session.account.encodeCalls([
      {
        to: config.usdc,
        value: 0n,
        data: encodeFunctionData({
          abi: parseAbi(["function mint(address,uint256)"]),
          functionName: "mint",
          args: [session.account.address, INITIAL_BALANCE],
        }),
      },
    ]),
    { kind: "funding" },
  );
  if (!receipt.success)
    throw new Error(
      "Test funding did not complete. Check the transaction before trying again.",
    );
  return {
    hash: receipt.receipt.transactionHash,
    balance: await readBalance(session.account.address),
  };
}

export async function sendPayment(
  session: WalletSession,
  quote: Quote,
  onSubmitted: () => void,
  invoiceId?: `0x${string}`,
) {
  if (quote.source !== "pool")
    throw new Error("A live payment requires a fresh onchain pool quote.");
  await verifyDeployment();
  validatePayment(quote, await readBalance(session.account.address));
  const callData = await session.account.encodeCalls(
    paymentCalls(quote, invoiceId),
  );
  // ZeroDev simulates and sponsors this operation. Default Kernel batching is atomic.
  const result = await submitOperation(
    session,
    callData,
    {
      kind: "payment",
      eurAmount: quote.eurAmount.toString(),
      maxUsdcAmount: quote.maxUsdcAmount.toString(),
    },
    onSubmitted,
    (receipt) =>
      paymentEvidence(session, receipt, quote.eurAmount, quote.maxUsdcAmount),
  );
  const { spent } = paymentEvidence(
    session,
    result,
    quote.eurAmount,
    quote.maxUsdcAmount,
  );
  const balance = await readBalance(session.account.address).catch(() => null);
  return { hash: result.receipt.transactionHash, spent, balance };
}

export function paymentEvidence(
  session: Pick<WalletSession, "account">,
  result: OperationReceipt,
  euros: bigint,
  maxDollars: bigint,
) {
  const config = paymentConfig();
  const transfers = parseEventLogs({
    abi: erc20Abi,
    logs: result.logs,
    eventName: "Transfer",
    strict: true,
  });
  const spent =
    transfers
      .filter(
        (log) =>
          log.address.toLowerCase() === config.usdc.toLowerCase() &&
          log.args.from.toLowerCase() === session.account.address.toLowerCase(),
      )
      .reduce((sum, log) => sum + log.args.value, 0n) -
    transfers
      .filter(
        (log) =>
          log.address.toLowerCase() === config.usdc.toLowerCase() &&
          log.args.to.toLowerCase() === session.account.address.toLowerCase(),
      )
      .reduce((sum, log) => sum + log.args.value, 0n);
  const delivered = transfers
    .filter(
      (log) =>
        log.address.toLowerCase() === config.eurc.toLowerCase() &&
        log.args.to.toLowerCase() === config.supplier.toLowerCase(),
    )
    .reduce((sum, log) => sum + log.args.value, 0n);
  if (delivered !== euros || spent <= 0n || spent > maxDollars)
    throw new Error(
      "The payment receipt needs review. Further sends are paused until delivery and spending can be verified.",
    );
  return { spent, delivered };
}
