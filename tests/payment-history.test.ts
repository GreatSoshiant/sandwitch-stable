import { beforeEach, describe, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => ({
  getBlockNumber: vi.fn(),
  getLogs: vi.fn(),
  getBlock: vi.fn(),
  verify: vi.fn(),
}));
vi.mock("../src/lib/chain", () => ({
  publicClient: rpc,
  verifyDeployment: rpc.verify,
}));
vi.mock("../src/lib/config", () => ({
  invoiceGateway: "0x1111111111111111111111111111111111111111",
  paymentHistoryStartBlock: 100n,
}));
import { readPaymentHistory } from "../src/lib/payment-history";
import {
  formatTokenUnits,
  mergeActivity,
  paymentActivities,
} from "../src/lib/payment";
const account = "0x2222222222222222222222222222222222222222";
const hash = `0x${"ab".repeat(32)}` as const;
beforeEach(() => {
  vi.clearAllMocks();
  rpc.getBlockNumber.mockResolvedValue(200n);
  rpc.getBlock.mockResolvedValue({ timestamp: 1000n });
  rpc.getLogs.mockResolvedValue([]);
});
describe("confirmed swap history", () => {
  it("restores exact exchange amounts and a shared transaction from gateway events, without inventing a bank payout", async () => {
    rpc.getLogs.mockResolvedValue([
      {
        removed: false,
        transactionHash: hash,
        blockNumber: 150n,
        args: { account, euros: 100_000_000n, dollars: 112_650_147n },
      },
      {
        removed: true,
        transactionHash: `0x${"cd".repeat(32)}`,
        blockNumber: 151n,
        args: { account, euros: 5n, dollars: 6n },
      },
    ]);
    const entries = await readPaymentHistory(account);
    expect(rpc.getLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        args: { account },
        fromBlock: 100n,
        toBlock: 200n,
        strict: true,
      }),
    );
    expect(entries.map((e) => e.kind)).toEqual(["payment", "swap"]);
    expect(
      entries.every(
        (e) => e.hash === hash && !e.simulated && e.time === 1_000_000,
      ),
    ).toBe(true);
    expect(entries[1].detail).toContain("112.650147 tUSDC → 100.00 tEURC");
    expect(entries[0].amount).toBe(112_650_147n);
    expect(entries[1].amount).toBeUndefined(); // No second debit in totals.
  });
  it("does not duplicate swap or payment when refreshing history", () => {
    const entries = paymentActivities({
      euros: 100_000_000n,
      dollars: 112_650_147n,
      hash,
      simulated: false,
      time: 1000,
    });
    const merged = mergeActivity(entries, entries);
    expect(merged).toHaveLength(2);
    expect(
      merged
        .filter((e) => e.kind === "payment")
        .reduce((n, e) => n + (e.amount || 0n), 0n),
    ).toBe(112_650_147n);
  });
  it("keeps preview simulated and preserves six-decimal execution amounts", () => {
    expect(formatTokenUnits(1_125_124_372n)).toBe("1,125.124372");
    expect(formatTokenUnits(100_000_000n)).toBe("100.00");
    const entries = paymentActivities({
      euros: 100_000_000n,
      dollars: 112_650_147n,
      simulated: true,
    });
    expect(entries.every((e) => e.simulated && !e.hash)).toBe(true);
    expect(entries[0].detail).toContain("preview");
  });
});
