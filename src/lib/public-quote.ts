import { maximumInput, type Quote } from "./payment";

export async function getPublicPoolQuote(eurAmount: bigint): Promise<Quote> {
  const response = await fetch(`/api/pool-quote?eurAmount=${eurAmount}`, {
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(
      "The Uniswap quote is unavailable. Refresh the quote to try again.",
    );
  const data = await response.json();
  if (
    data.source !== "pool" ||
    data.chainId !== 421614 ||
    ![data.eurAmount, data.usdcAmount, data.maxUsdcAmount].every(
      (value) => typeof value === "string" && /^[1-9]\d*$/.test(value),
    )
  )
    throw new Error("The Uniswap quote could not be verified.");
  const dollars = BigInt(data.usdcAmount);
  if (
    BigInt(data.eurAmount) !== eurAmount ||
    BigInt(data.maxUsdcAmount) !== maximumInput(dollars) ||
    !Number.isFinite(data.expiresAt) ||
    data.expiresAt <= Date.now()
  )
    throw new Error(
      "The Uniswap quote expired or could not be verified. Refresh it to try again.",
    );
  return {
    eurAmount,
    usdcAmount: dollars,
    maxUsdcAmount: BigInt(data.maxUsdcAmount),
    expiresAt: data.expiresAt,
    source: "pool",
  };
}
