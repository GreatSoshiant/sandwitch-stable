import type { Quote } from "./payment";

export type ReferenceRate = {
  usdPerEuro: number;
  usdPerUsdc: number | null;
  usdcPerEuro: number | null;
  source: string;
  live: boolean;
  updatedAt: number | null;
};
export const REFERENCE_MAX_AGE_MS = 15 * 60_000;
export function referenceIsFresh(rate: ReferenceRate, now = Date.now()) {
  return (
    rate.live &&
    rate.usdcPerEuro !== null &&
    Number.isFinite(rate.usdcPerEuro) &&
    rate.usdcPerEuro > 0 &&
    Number.isSafeInteger(Math.round(rate.usdcPerEuro * 100_000_000)) &&
    rate.updatedAt !== null &&
    Number.isFinite(rate.updatedAt) &&
    now - rate.updatedAt <= REFERENCE_MAX_AGE_MS &&
    rate.updatedAt <= now + 60_000
  );
}
export function marketReference(
  data: unknown,
  now = Date.now(),
): ReferenceRate {
  const prices = data as Record<
    string,
    { usd?: number; last_updated_at?: number }
  >;
  const euro = prices?.["euro-coin"],
    dollar = prices?.["usd-coin"];
  if (
    ![
      euro?.usd,
      dollar?.usd,
      euro?.last_updated_at,
      dollar?.last_updated_at,
    ].every(
      (value) =>
        typeof value === "number" && Number.isFinite(value) && value > 0,
    )
  )
    throw new Error("Market reference unavailable");
  const result: ReferenceRate = {
    usdPerEuro: euro.usd!,
    usdPerUsdc: dollar.usd!,
    usdcPerEuro: euro.usd! / dollar.usd!,
    source: "CoinGecko · EURC/USDC reference",
    updatedAt: Math.min(euro.last_updated_at!, dollar.last_updated_at!) * 1000,
    live: true,
  };
  if (!referenceIsFresh(result, now))
    throw new Error("Market reference is stale");
  return result;
}
export function compareQuote(quote: Quote, usdcPerEuro: number) {
  const scaled = Math.round(usdcPerEuro * 100_000_000);
  if (!Number.isSafeInteger(scaled) || scaled <= 0 || quote.eurAmount <= 0n)
    throw new Error("Invalid comparison rate");
  const referenceCost =
    (quote.eurAmount * BigInt(scaled) + 99_999_999n) / 100_000_000n;
  const difference = quote.usdcAmount - referenceCost;
  return {
    referenceCost,
    difference,
    percentDifference: (Number(difference) * 100) / Number(referenceCost),
  };
}
