import {
  formatUserOperationRequest,
  getUserOperationHash,
} from "viem/account-abstraction";
import { getEntryPoint } from "@zerodev/sdk/constants";
import { type Address, type Hex } from "viem";
import type { WalletSession } from "./wallet";
export type OperationReceipt = Awaited<
  ReturnType<WalletSession["client"]["waitForUserOperationReceipt"]>
>;

export type PendingOperation = {
  version: 1;
  chainId: 421614;
  account: Address;
  hash: Hex;
  kind: "payment" | "funding" | "security" | "rate-demo";
  createdAt: number;
  eurAmount?: string;
  maxUsdcAmount?: string;
};
const key = (account: Address) => `tidewater:pending:${account.toLowerCase()}`;
export function loadPending(account: Address): PendingOperation | null {
  const raw = localStorage.getItem(key(account));
  if (!raw) return null;
  const record = JSON.parse(raw) as PendingOperation;
  if (
    record.version !== 1 ||
    record.chainId !== 421614 ||
    record.account.toLowerCase() !== account.toLowerCase() ||
    !/^0x[0-9a-fA-F]{64}$/.test(record.hash)
  )
    throw new Error(
      "Saved payment information is invalid. Check the account onchain before sending again.",
    );
  return record;
}
export function clearPending(account: Address) {
  localStorage.removeItem(key(account));
}
export class OperationPendingError extends Error {
  constructor(public operation: PendingOperation) {
    super(
      "Confirmation is pending. Check status before sending anything else.",
    );
  }
}
export class OperationRevertedError extends Error {
  constructor(public transactionHash: Hex) {
    super(
      "The operation reverted onchain. Its changes were rolled back. Refresh the quote before retrying.",
    );
  }
}

// Prepare and sign first, then save the exact hash BEFORE the only broadcast.
// A lost RPC response cannot turn a retry into a second payment.
export async function submitOperation(
  session: Pick<WalletSession, "account" | "client">,
  callData: Hex,
  metadata: Pick<PendingOperation, "kind" | "eurAmount" | "maxUsdcAmount">,
  onSubmitted?: (pending: PendingOperation) => void,
  verify?: (receipt: OperationReceipt) => void,
) {
  const existing = loadPending(session.account.address);
  if (existing) throw new OperationPendingError(existing);
  const prepared = await session.client.prepareUserOperation({ callData });
  const signature = await session.account.signUserOperation(prepared);
  const signed = { ...prepared, signature };
  const hash = getUserOperationHash({
    userOperation: signed,
    entryPointAddress: getEntryPoint("0.7").address,
    entryPointVersion: "0.7",
    chainId: 421614,
  });
  const pending: PendingOperation = {
    version: 1,
    chainId: 421614,
    account: session.account.address,
    hash,
    createdAt: Date.now(),
    ...metadata,
  };
  localStorage.setItem(key(pending.account), JSON.stringify(pending));
  onSubmitted?.(pending);
  try {
    await session.client.request({
      method: "eth_sendUserOperation",
      params: [
        formatUserOperationRequest(signed),
        getEntryPoint("0.7").address,
      ],
    });
  } catch (error) {
    // A JSON-RPC validation rejection is definitive. Transport errors are not.
    const cause = error as {
      walk?: (predicate: (e: { code?: number }) => boolean) => {
        code?: number;
      };
    };
    const rejected = cause.walk?.(
      (e) =>
        typeof e.code === "number" &&
        (e.code === -32602 || (e.code <= -32500 && e.code >= -32510)),
    );
    if (rejected && typeof rejected.code === "number") {
      clearPending(pending.account);
      throw new Error(
        "The network rejected this operation before inclusion. No payment was sent. Refresh the quote and try again.",
      );
    }
    throw new OperationPendingError(pending);
  }
  try {
    const receipt = await session.client.waitForUserOperationReceipt({
      hash,
      timeout: 60_000,
    });
    if (!receipt.success) {
      clearPending(pending.account);
      throw new OperationRevertedError(receipt.receipt.transactionHash);
    }
    verify?.(receipt);
    clearPending(pending.account);
    return receipt;
  } catch (error) {
    if (error instanceof OperationRevertedError) throw error;
    throw new OperationPendingError(pending);
  }
}

export async function checkOperation(
  session: Pick<WalletSession, "account" | "client">,
  verify?: (pending: PendingOperation, receipt: OperationReceipt) => void,
) {
  const pending = loadPending(session.account.address);
  if (!pending) return null;
  // Never re-submit here. A missing receipt leaves the duplicate-payment lock in place.
  let receipt;
  try {
    receipt = await session.client.getUserOperationReceipt({
      hash: pending.hash,
    });
  } catch {
    throw new OperationPendingError(pending);
  }
  if (!receipt) throw new OperationPendingError(pending);
  if (receipt.success) {
    if (pending.kind === "payment" && !verify)
      throw new OperationPendingError(pending);
    try {
      verify?.(pending, receipt);
    } catch {
      throw new OperationPendingError(pending);
    }
  }
  clearPending(pending.account);
  return { pending, receipt };
}
