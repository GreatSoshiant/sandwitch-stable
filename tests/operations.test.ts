import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  submitOperation,
  checkOperation,
  loadPending,
  OperationPendingError,
  OperationRevertedError,
} from "../src/lib/operations";
import type { WalletSession } from "../src/lib/wallet";

const account = "0x1111111111111111111111111111111111111111";
const transactionHash = `0x${"12".repeat(32)}`;
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  });
});
function wallet() {
  const receipt = {
    success: true,
    receipt: { transactionHash, status: "success" },
  };
  const session = {
    account: {
      address: account,
      signUserOperation: vi.fn(async () => "0x1234"),
    },
    client: {
      prepareUserOperation: vi.fn(async () => ({
        sender: account,
        nonce: 0n,
        callData: "0x",
        callGasLimit: 100000n,
        verificationGasLimit: 100000n,
        preVerificationGas: 21000n,
        maxFeePerGas: 1n,
        maxPriorityFeePerGas: 1n,
      })),
      request: vi.fn(async () => "0x"),
      waitForUserOperationReceipt: vi.fn(async () => receipt),
      getUserOperationReceipt: vi.fn(async () => receipt),
    },
  };
  return {
    session: session as unknown as WalletSession,
    mocks: session,
    receipt,
  };
}
describe("durable user operation tracking", () => {
  it("keeps a successful operation locked when delivery evidence cannot be verified", async () => {
    const { session } = wallet();
    await expect(
      submitOperation(session, "0x", { kind: "payment" }, undefined, () => {
        throw new Error("missing EURC delivery");
      }),
    ).rejects.toBeInstanceOf(OperationPendingError);
    expect(loadPending(account)).not.toBeNull();
    await expect(
      checkOperation(session, () => {
        throw new Error("still missing");
      }),
    ).rejects.toBeInstanceOf(OperationPendingError);
    expect(loadPending(account)).not.toBeNull();
    await checkOperation(session, () => {});
    expect(loadPending(account)).toBeNull();
  });
  it("persists the exact hash before broadcasting and clears it only after confirmation", async () => {
    const { session, mocks } = wallet();
    mocks.client.request.mockImplementation(async () => {
      expect(loadPending(account)?.hash).toMatch(/^0x[a-f0-9]{64}$/);
      return "0x";
    });
    await submitOperation(session, "0x", {
      kind: "payment",
      eurAmount: "1000",
    });
    expect(loadPending(account)).toBeNull();
    expect(mocks.client.request).toHaveBeenCalledTimes(1);
  });
  it("retains a lost broadcast response and prevents resubmission across a new session", async () => {
    const { session, mocks } = wallet();
    mocks.client.request.mockRejectedValue(new Error("connection lost"));
    await expect(
      submitOperation(session, "0x", { kind: "payment" }),
    ).rejects.toBeInstanceOf(OperationPendingError);
    const second = wallet();
    await expect(
      submitOperation(second.session, "0x", { kind: "payment" }),
    ).rejects.toBeInstanceOf(OperationPendingError);
    expect(second.mocks.client.request).not.toHaveBeenCalled();
    await checkOperation(second.session, () => {});
    expect(loadPending(account)).toBeNull();
    expect(second.mocks.client.request).not.toHaveBeenCalled();
  });
  it("keeps a missing receipt locked, then distinguishes confirmed reversion", async () => {
    const { session, mocks } = wallet();
    mocks.client.waitForUserOperationReceipt.mockRejectedValue(
      new Error("timeout"),
    );
    await expect(
      submitOperation(session, "0x", { kind: "payment" }),
    ).rejects.toBeInstanceOf(OperationPendingError);
    mocks.client.getUserOperationReceipt.mockRejectedValueOnce(
      new Error("not found"),
    );
    await expect(checkOperation(session)).rejects.toBeInstanceOf(
      OperationPendingError,
    );
    expect(loadPending(account)).not.toBeNull();
    mocks.client.getUserOperationReceipt.mockResolvedValue({
      success: false,
      receipt: { transactionHash, status: "success" },
    });
    expect((await checkOperation(session))?.receipt.success).toBe(false);
    expect(loadPending(account)).toBeNull();
  });
  it("reports a confirmed execution revert as retryable, with its real transaction hash", async () => {
    const { session, mocks } = wallet();
    mocks.client.waitForUserOperationReceipt.mockResolvedValue({
      success: false,
      receipt: { transactionHash, status: "success" },
    });
    await expect(
      submitOperation(session, "0x", { kind: "payment" }),
    ).rejects.toBeInstanceOf(OperationRevertedError);
    expect(loadPending(account)).toBeNull();
  });
  it("clears a definitive bundler validation rejection, while never treating HTTP timeouts as rejection", async () => {
    const { session, mocks } = wallet();
    mocks.client.request.mockRejectedValue({
      walk: (predicate: (e: { code: number }) => boolean) =>
        predicate({ code: -32500 }) ? { code: -32500 } : null,
    });
    await expect(
      submitOperation(session, "0x", { kind: "payment" }),
    ).rejects.toThrow("rejected");
    expect(loadPending(account)).toBeNull();
  });
});
