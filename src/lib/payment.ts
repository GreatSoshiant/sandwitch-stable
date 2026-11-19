export const SLIPPAGE_BPS = 30n;
export const QUOTE_LIFETIME_MS = 30_000;
export const INITIAL_BALANCE = 1_500_000_000n;

export type Quote = {
  eurAmount: bigint;
  usdcAmount: bigint;
  maxUsdcAmount: bigint;
  expiresAt: number;
  source: "pool" | "preview";
};

export function parseEuroAmount(input: string): bigint {
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(input.trim())) {
    throw new Error("Enter a euro amount with up to two decimal places.");
  }
  const [whole, fraction = ""] = input.trim().split(".");
  const amount = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  if (amount <= 0n) throw new Error("Enter an amount greater than €0.");
  return amount;
}

export function maximumInput(quoted: bigint): bigint {
  if (quoted <= 0n)
    throw new Error("The payment quote must be greater than zero.");
  // Integer arithmetic, rounded up; never lose the final micro-USDC to a float.
  return (quoted * (10_000n + SLIPPAGE_BPS) + 9_999n) / 10_000n;
}

export function previewQuote(
  eurAmount: bigint,
  usdPerEuro: number,
  now = Date.now(),
): Quote {
  if (!Number.isFinite(usdPerEuro) || usdPerEuro <= 0)
    throw new Error("Exchange rate unavailable.");
  const rate = BigInt(Math.round(usdPerEuro * 1_000_000));
  const usdcAmount = (eurAmount * rate + 999_999n) / 1_000_000n;
  return {
    eurAmount,
    usdcAmount,
    maxUsdcAmount: maximumInput(usdcAmount),
    expiresAt: now + QUOTE_LIFETIME_MS,
    source: "preview",
  };
}

export function validatePayment(
  quote: Quote,
  balance: bigint,
  now = Date.now(),
) {
  if (now >= quote.expiresAt)
    throw new Error("Your quote expired. Refresh the quote before sending.");
  if (balance < quote.maxUsdcAmount)
    throw new Error(
      "Not enough USDC to cover the payment and the 0.3% rate allowance.",
    );
}

export function formatMoney(amount: bigint, currency: "USD" | "EUR" = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    Number(amount) / 1_000_000,
  );
}

export function formatUnits6(amount: bigint) {
  return (Number(amount) / 1_000_000).toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}

export function formatTokenUnits(amount: bigint) {
  const whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}.${fraction.padEnd(2, "0")}`;
}

export type Activity = {
  id: string;
  kind: "funding" | "blocked" | "payment" | "payout" | "security" | "swap";
  title: string;
  detail: string;
  amount?: bigint;
  time: number;
  simulated: boolean;
  hash?: `0x${string}`;
  swap?: { usdcAmount: bigint; eurcAmount: bigint };
};

export function paymentActivities({
  euros,
  dollars,
  hash,
  simulated,
  time = Date.now(),
  title = "Payment to Kessler",
}: {
  euros: bigint;
  dollars: bigint;
  hash?: `0x${string}`;
  simulated: boolean;
  time?: number;
  title?: string;
}): Activity[] {
  const id = hash || `preview-${time}`;
  return [
    {
      id: `swap:${id}`,
      kind: "swap",
      title: "USDC → EURC swap",
      detail: `${simulated ? "Uniswap v3 preview" : "Uniswap v3 · 0.01% pool"} · ${formatTokenUnits(dollars)} tUSDC → ${formatTokenUnits(euros)} tEURC`,
      time,
      simulated,
      hash,
      swap: { usdcAmount: dollars, eurcAmount: euros },
    },
    {
      id: `payment:${id}`,
      kind: "payment",
      title,
      detail: `${formatMoney(euros, "EUR")} ${simulated ? "delivery simulated" : "tEURC delivered"} · Invoice KW-2026-042`,
      amount: dollars,
      time,
      simulated,
      hash,
    },
  ];
}

export function mergeActivity(current: Activity[], incoming: Activity[]) {
  const seen = new Set(
    current.map((item) => (item.hash ? `${item.kind}:${item.hash}` : item.id)),
  );
  return [
    ...current,
    ...incoming.filter((item) => {
      const key = item.hash ? `${item.kind}:${item.hash}` : item.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  ].sort((a, b) => b.time - a.time);
}
