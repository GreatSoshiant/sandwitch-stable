import { describe, expect, it } from "vitest";
import {
  compareQuote,
  marketReference,
  referenceIsFresh,
  REFERENCE_MAX_AGE_MS,
} from "../src/lib/rates";
import { previewQuote } from "../src/lib/payment";
const now = 1_800_000_000_000;
const price = (usd: number, age = 0) => ({
  usd,
  last_updated_at: (now - age) / 1000,
});
describe("Uniswap and market comparison", () => {
  it("converts EURC/USD and USDC/USD into the same EURC/USDC pair", () => {
    const reference = marketReference(
      { "euro-coin": price(1.1), "usd-coin": price(0.99) },
      now,
    );
    expect(reference.usdcPerEuro).toBeCloseTo(1.1 / 0.99, 12);
    expect(reference.usdcPerEuro).not.toBe(reference.usdPerEuro);
    expect(referenceIsFresh(reference, now)).toBe(true);
  });
  it("rejects missing, invalid and stale prices from either token", () => {
    for (const payload of [
      { "euro-coin": price(1.1) },
      { "euro-coin": price(1.1), "usd-coin": price(0) },
      {
        "euro-coin": price(1.1),
        "usd-coin": price(1, REFERENCE_MAX_AGE_MS + 1000),
      },
      { "euro-coin": price(Infinity), "usd-coin": price(1) },
      { "euro-coin": price(1.1), "usd-coin": price(1e-20) },
      { "euro-coin": price(1.1, -120000), "usd-coin": price(1, -120000) },
    ])
      expect(() => marketReference(payload, now)).toThrow();
  });
  it("uses the oldest provider timestamp and expires it on the client", () => {
    const reference = marketReference(
      { "euro-coin": price(1.1, 1000), "usd-coin": price(1, 60000) },
      now,
    );
    expect(reference.updatedAt).toBe(now - 60000);
    expect(referenceIsFresh(reference, now + REFERENCE_MAX_AGE_MS)).toBe(false);
    expect(referenceIsFresh({ ...reference, live: false }, now)).toBe(false);
  });
  it("compares the quoted input cost, excluding the 0.3% maximum-input allowance", () => {
    const quote = previewQuote(1_000_000_000n, 1.2, now);
    const result = compareQuote(quote, 1.1);
    expect(result.referenceCost).toBe(1_100_000_000n);
    expect(result.difference).toBe(100_000_000n);
    expect(result.percentDifference).toBeCloseTo(9.090909, 5);
    expect(quote.maxUsdcAmount).toBe(1_203_600_000n);
  });
  it("handles cheaper pool prices and rounds reference inputs up to micro-USDC", () => {
    expect(
      compareQuote(previewQuote(1_000_000_000n, 1, now), 1.1).difference,
    ).toBe(-100_000_000n);
    expect(compareQuote(previewQuote(1n, 1, now), 1.1).referenceCost).toBe(2n);
    expect(() => compareQuote(previewQuote(1n, 1, now), NaN)).toThrow();
  });
});
