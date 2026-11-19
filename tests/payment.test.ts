import { describe, expect, it } from "vitest";
import {
  INITIAL_BALANCE,
  maximumInput,
  parseEuroAmount,
  previewQuote,
  validatePayment,
} from "../src/lib/payment";

describe("payment amounts and protection", () => {
  it("keeps cents exact in six-decimal token units", () => {
    expect(parseEuroAmount("1000.01")).toBe(1_000_010_000n);
    expect(parseEuroAmount("0.01")).toBe(10_000n);
  });
  it.each(["0", "-1", "1e3", "NaN", "1.001", "1000 USD", "", "Infinity"])(
    "rejects invalid amount %s",
    (amount) => {
      expect(() => parseEuroAmount(amount)).toThrow();
    },
  );
  it("caps spending at 0.3% above the quote with integer rounding", () => {
    expect(maximumInput(1_080_000_000n)).toBe(1_083_240_000n);
    expect(maximumInput(1n)).toBe(2n);
    const quote = previewQuote(1_000_000_000n, 1.08, 1000);
    const badRateCost = (quote.usdcAmount * 10_050n) / 10_000n;
    expect(badRateCost > quote.maxUsdcAmount).toBe(true);
    expect((quote.usdcAmount * 10_030n) / 10_000n <= quote.maxUsdcAmount).toBe(
      true,
    );
  });
  it("rejects expired quotes including the expiry boundary", () => {
    const quote = previewQuote(1_000_000_000n, 1.08, 1000);
    expect(() => validatePayment(quote, INITIAL_BALANCE, 30_999)).not.toThrow();
    expect(() => validatePayment(quote, INITIAL_BALANCE, 31_000)).toThrow(
      /expired/,
    );
  });
  it("requires enough balance for the maximum input, not just the displayed quote", () => {
    const quote = previewQuote(1_000_000_000n, 1.08, 1000);
    expect(() => validatePayment(quote, quote.usdcAmount, 1001)).toThrow(
      /Not enough/,
    );
    expect(() =>
      validatePayment(quote, quote.maxUsdcAmount, 1001),
    ).not.toThrow();
  });
});
