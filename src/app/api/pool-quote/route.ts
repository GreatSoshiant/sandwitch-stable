import { NextResponse } from "next/server";
import { getPoolQuote } from "@/lib/chain";
import { paymentConfig } from "@/lib/config";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, max-age=0" };
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("eurAmount") || "";
  if (!/^[1-9]\d{0,12}$/.test(raw))
    return NextResponse.json(
      { error: "Enter a valid EURC amount." },
      { status: 400, headers },
    );
  const euros = BigInt(raw);
  if (euros > 9_999_999_990_000n)
    return NextResponse.json(
      { error: "The amount is above the demo quote limit." },
      { status: 400, headers },
    );
  try {
    // Public read-only Uniswap Quoter call; no wallet, sponsorship or transaction.
    const quote = await getPoolQuote(euros);
    const config = paymentConfig();
    return NextResponse.json(
      {
        eurAmount: quote.eurAmount.toString(),
        usdcAmount: quote.usdcAmount.toString(),
        maxUsdcAmount: quote.maxUsdcAmount.toString(),
        expiresAt: quote.expiresAt,
        source: "pool",
        chainId: 421614,
        pool: config.pool,
        quoter: config.quoter,
      },
      { headers },
    );
  } catch {
    return NextResponse.json(
      {
        error:
          "The Uniswap quote is unavailable. Refresh the quote to try again.",
      },
      { status: 503, headers },
    );
  }
}
