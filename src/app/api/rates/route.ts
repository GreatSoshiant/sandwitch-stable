import { NextResponse } from "next/server";
import { marketReference } from "@/lib/rates";

export async function GET() {
  try {
    const key = process.env.COINGECKO_DEMO_API_KEY;
    const response = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=euro-coin,usd-coin&vs_currencies=usd&include_last_updated_at=true",
      {
        headers: key ? { "x-cg-demo-api-key": key } : {},
        next: { revalidate: 60 },
        signal: AbortSignal.timeout(6000),
      },
    );
    if (!response.ok) throw new Error("Reference rate provider unavailable");
    return NextResponse.json(marketReference(await response.json()));
  } catch {
    // Explicit preview fallback, never represented as a live or executable pool quote.
    return NextResponse.json({
      usdPerEuro: 1.08,
      usdPerUsdc: null,
      usdcPerEuro: null,
      source: "Illustrative reference rate",
      updatedAt: null,
      live: false,
    });
  }
}
