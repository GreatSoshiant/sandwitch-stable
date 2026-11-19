"use client";

import { ArrowLeftRight, RefreshCw } from "lucide-react";
import { formatMoney, formatUnits6, type Quote } from "@/lib/payment";
import {
  compareQuote,
  referenceIsFresh,
  type ReferenceRate,
} from "@/lib/rates";

export function RateComparison({
  quote,
  reference,
  now,
  loading = false,
  compact = false,
  error,
  onRefresh,
  simulatedPayment = false,
  poolPricing = false,
}: {
  quote: Quote | null;
  reference: ReferenceRate;
  now: number;
  loading?: boolean;
  compact?: boolean;
  error?: string;
  onRefresh?: () => void;
  simulatedPayment?: boolean;
  poolPricing?: boolean;
}) {
  const currentTime = now || Date.now();
  const expired = Boolean(quote && currentTime >= quote.expiresAt);
  const fresh = referenceIsFresh(reference, currentTime);
  const comparison =
    quote && fresh && !expired
      ? compareQuote(quote, reference.usdcPerEuro!)
      : null;
  const pool = quote?.source === "pool" || (!quote && poolPricing);
  const minutes = reference.updatedAt
    ? Math.max(0, Math.floor((currentTime - reference.updatedAt) / 60_000))
    : 0;
  const absoluteDifference = comparison
    ? comparison.difference < 0n
      ? -comparison.difference
      : comparison.difference
    : 0n;
  return (
    <section
      className={`rate-comparison ${compact ? "compact" : ""}`}
      aria-label="Exchange rate comparison"
    >
      <header className="rate-comparison-header">
        <span>
          <ArrowLeftRight size={15} />
          {pool ? "Uniswap v3 payment rate" : "Payment rate"}
        </span>
        <span className={`rate-source-badge ${expired ? "expired" : ""}`}>
          {expired
            ? "Quote expired"
            : quote
              ? pool
                ? "Onchain quote"
                : "Simulated"
              : loading
                ? "Loading"
                : "Unavailable"}
        </span>
      </header>
      <div className="execution-rate">
        {quote ? (
          <>
            <span>1 tEURC</span>
            <span aria-hidden="true">=</span>
            <strong>
              {(Number(quote.usdcAmount) / Number(quote.eurAmount)).toFixed(4)}{" "}
              <small>tUSDC</small>
            </strong>
          </>
        ) : (
          <span>
            {loading ? "Getting the pool quote…" : "Quote unavailable"}
          </span>
        )}
      </div>
      <p className="execution-rate-caption">
        {quote
          ? `For ${formatMoney(quote.eurAmount, "EUR")} ${pool ? "on Arbitrum Sepolia" : "in preview"}`
          : "A fresh quote is needed to compare payment costs."}
        {pool && <span>Includes the 0.01% pool fee and price impact.</span>}
        {pool && simulatedPayment && (
          <span>Live pool pricing · preview payments stay simulated.</span>
        )}
      </p>
      <table className="rate-comparison-table">
        <caption>Cost for the same supplier payment</caption>
        <thead>
          <tr>
            <th scope="col">Price source</th>
            <th scope="col">
              {pool ? "Cost in tUSDC" : "Cost in preview USDC"}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">
              {pool ? "Uniswap pool quote" : "Illustrative preview quote"}
            </th>
            <td>{quote ? formatUnits6(quote.usdcAmount) : "—"}</td>
          </tr>
          <tr>
            <th scope="row">CoinGecko reference</th>
            <td>{comparison ? formatUnits6(comparison.referenceCost) : "—"}</td>
          </tr>
        </tbody>
      </table>
      {comparison ? (
        <div
          className={`rate-difference ${comparison.difference > 0n ? "above" : "below"}`}
          role="status"
        >
          {absoluteDifference < 10_000n ? (
            "Within 0.01 USDC of the CoinGecko reference."
          ) : (
            <>
              <b>
                {formatUnits6(absoluteDifference)}{" "}
                {pool ? "tUSDC" : "preview USDC"}{" "}
                {comparison.difference > 0n ? "higher" : "lower"}
              </b>
              <span>
                {Math.abs(comparison.percentDifference).toFixed(2)}%{" "}
                {comparison.difference > 0n ? "above" : "below"} CoinGecko’s
                reference
              </span>
            </>
          )}
        </div>
      ) : (
        <p className="rate-comparison-status" role="status">
          {expired
            ? "Refresh the quote to compare current prices."
            : fresh
              ? "Waiting for a payment quote."
              : "CoinGecko comparison is unavailable right now."}
        </p>
      )}
      <div className="rate-comparison-footnote">
        {fresh ? (
          <span>
            Market reference: 1 EURC ≈ {reference.usdcPerEuro!.toFixed(4)} USDC
            · Updated {minutes < 1 ? "just now" : `${minutes} min ago`}.
          </span>
        ) : (
          <span>
            The payment quote remains independent of the market reference.
          </span>
        )}
        <span>
          {pool
            ? "Source: Uniswap Quoter on Arbitrum Sepolia. CoinGecko independently tracks market EURC and USDC."
            : "Preview amounts are simulated."}{" "}
          Reference estimate for comparison.
        </span>
      </div>
      {(onRefresh || error) && (
        <div className="rate-comparison-actions">
          {error && <span role="status">{error}</span>}
          {onRefresh && (
            <button
              className="text-button"
              disabled={loading}
              onClick={onRefresh}
            >
              <RefreshCw size={13} className={loading ? "spin" : ""} />
              Refresh {pool ? "Uniswap " : ""}quote
            </button>
          )}
        </div>
      )}
    </section>
  );
}
