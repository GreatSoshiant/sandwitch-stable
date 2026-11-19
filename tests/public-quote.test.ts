import { afterEach, describe, expect, it, vi } from "vitest";
import { getPublicPoolQuote } from "../src/lib/public-quote";
const data = () => ({
  eurAmount: "1000000000",
  usdcAmount: "1130000000",
  maxUsdcAmount: "1133390000",
  expiresAt: Date.now() + 30000,
  source: "pool",
  chainId: 421614,
});
afterEach(() => vi.unstubAllGlobals());
describe("public Uniswap quotes", () => {
  it("reads a pool quote without a wallet or a CoinGecko input", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => data() }));
    vi.stubGlobal("fetch", fetcher);
    const quote = await getPublicPoolQuote(1_000_000_000n);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/pool-quote?eurAmount=1000000000",
      { cache: "no-store" },
    );
    expect(quote.source).toBe("pool");
    expect(quote.usdcAmount).toBe(1_130_000_000n);
  });
  it("reports unavailable rather than inventing a fallback price", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false })),
    );
    await expect(getPublicPoolQuote(1_000_000_000n)).rejects.toThrow(
      "Uniswap quote is unavailable",
    );
  });
  it("rejects wrong amounts, source labels, expired quotes and invalid spending limits", async () => {
    for (const patch of [
      { eurAmount: "1" },
      { source: "preview" },
      { expiresAt: Date.now() - 1 },
      { maxUsdcAmount: "1130000000" },
      { usdcAmount: "NaN" },
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: true,
          json: async () => ({ ...data(), ...patch }),
        })),
      );
      await expect(getPublicPoolQuote(1_000_000_000n)).rejects.toThrow();
    }
  });
});
