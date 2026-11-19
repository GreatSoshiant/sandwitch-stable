import {
  BaseError,
  ContractFunctionRevertedError,
  encodeFunctionData,
  erc20Abi,
  parseAbi,
  type Hex,
} from "viem";
import {
  publicClient,
  verifyDeployment,
  poolAbi,
  routerAbi,
  gatewayAbi,
  getPoolQuote,
} from "./chain";
import { invoiceGateway } from "./config";
import type { WalletSession } from "./wallet";
import { submitOperation, loadPending } from "./operations";
import type { Quote } from "./payment";

const storageKey = (account: string) =>
  `tidewater:rate-demo:${account.toLowerCase()}`;
type DemoState = {
  baselineEuro: string;
  startedAt: number;
  shockHash?: Hex;
  protectionVerified?: boolean;
};
export function rateDemoState(session: WalletSession): DemoState | null {
  return JSON.parse(
    localStorage.getItem(storageKey(session.account.address)) || "null",
  );
}
function save(session: WalletSession, state: DemoState) {
  localStorage.setItem(
    storageKey(session.account.address),
    JSON.stringify(state),
  );
}
const mintAbi = parseAbi(["function mint(address,uint256)"]);
function sqrt(n: bigint) {
  if (n < 2n) return n;
  let x = n,
    y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}
export function priceMoveInput(
  liquidity: bigint,
  price: bigint,
  dollarIsToken0: boolean,
) {
  const q96 = 2n ** 96n;
  const target = dollarIsToken0
    ? sqrt((price * price * 1000n) / 1005n)
    : sqrt((price * price * 1005n) / 1000n);
  const amount = dollarIsToken0
    ? (liquidity * (price - target) * q96) / (price * target)
    : (liquidity * (target - price)) / q96;
  return (amount * 10_000n + 9_998n) / 9_999n + 10n;
}
const approve = (
  token: `0x${string}`,
  spender: `0x${string}`,
  amount: bigint,
) => ({
  to: token,
  value: 0n,
  data: encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [spender, amount],
  }),
});
const exactInputQuoteAbi = parseAbi([
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256,uint160,uint32,uint256)",
]);
export async function restorePool(session: WalletSession) {
  const state = rateDemoState(session);
  if (!state) return null;
  if (loadPending(session.account.address))
    throw new Error("Check the pending operation before restoring the pool.");
  const c = await verifyDeployment();
  const balance = await publicClient.readContract({
    address: c.eurc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [session.account.address],
  });
  const euros = balance - BigInt(state.baselineEuro);
  if (euros <= 0n) {
    localStorage.removeItem(storageKey(session.account.address));
    return null;
  }
  const { result } = await publicClient.simulateContract({
    address: c.quoter,
    abi: exactInputQuoteAbi,
    functionName: "quoteExactInputSingle",
    args: [
      {
        tokenIn: c.eurc,
        tokenOut: c.usdc,
        amountIn: euros,
        fee: 100,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });
  const receipt = await submitOperation(
    session,
    await session.account.encodeCalls([
      approve(c.eurc, c.router, 0n),
      approve(c.eurc, c.router, euros),
      {
        to: c.router,
        value: 0n,
        data: encodeFunctionData({
          abi: routerAbi,
          functionName: "exactInputSingle",
          args: [
            {
              tokenIn: c.eurc,
              tokenOut: c.usdc,
              fee: 100,
              recipient: session.account.address,
              deadline: BigInt(Math.floor(Date.now() / 1000) + 300),
              amountIn: euros,
              amountOutMinimum: (result[0] * 997n) / 1000n,
              sqrtPriceLimitX96: 0n,
            },
          ],
        }),
      },
      approve(c.eurc, c.router, 0n),
      ...(invoiceGateway ? [approve(c.usdc, invoiceGateway, 0n)] : []),
    ]),
    { kind: "rate-demo" },
  );
  localStorage.removeItem(storageKey(session.account.address));
  return receipt.receipt.transactionHash;
}
export async function runRateDemo(
  session: WalletSession,
  onEvent: (title: string, detail: string, hash?: Hex) => void,
) {
  if (!invoiceGateway || process.env.NEXT_PUBLIC_ENABLE_TEST_FAUCET !== "true")
    throw new Error(
      "The test pool and faucet must be enabled for this demonstration.",
    );
  if (rateDemoState(session))
    throw new Error("Restore the previous rate demonstration first.");
  const c = await verifyDeployment();
  const original: Quote = {
    ...(await getPoolQuote(1_000_000_000n)),
    expiresAt: Date.now() + 300_000,
  };
  const [slot, liquidity, token0, baseline] = await Promise.all([
    publicClient.readContract({
      address: c.pool,
      abi: poolAbi,
      functionName: "slot0",
    }),
    publicClient.readContract({
      address: c.pool,
      abi: poolAbi,
      functionName: "liquidity",
    }),
    publicClient.readContract({
      address: c.pool,
      abi: poolAbi,
      functionName: "token0",
    }),
    publicClient.readContract({
      address: c.eurc,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [session.account.address],
    }),
  ]);
  const input = priceMoveInput(
    liquidity,
    slot[0],
    token0.toLowerCase() === c.usdc.toLowerCase(),
  );
  if (input <= 0n || input > 15_000_000_000n)
    throw new Error(
      "Pool depth is outside the controlled demo’s 15,000 test USDC limit.",
    );
  const minted = input + original.maxUsdcAmount;
  const mintCalls = [];
  for (let rest = minted; rest > 0n; rest -= 1_500_000_000n)
    mintCalls.push({
      to: c.usdc,
      value: 0n,
      data: encodeFunctionData({
        abi: mintAbi,
        functionName: "mint",
        args: [
          session.account.address,
          rest > 1_500_000_000n ? 1_500_000_000n : rest,
        ],
      }),
    });
  const quoteInput = await publicClient.simulateContract({
    address: c.quoter,
    abi: exactInputQuoteAbi,
    functionName: "quoteExactInputSingle",
    args: [
      {
        tokenIn: c.usdc,
        tokenOut: c.eurc,
        amountIn: input,
        fee: 100,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });
  const state: DemoState = {
    baselineEuro: baseline.toString(),
    startedAt: Date.now(),
  };
  save(session, state);
  try {
    const receipt = await submitOperation(
      session,
      await session.account.encodeCalls([
        ...mintCalls,
        approve(c.usdc, c.router, 0n),
        approve(c.usdc, c.router, input),
        {
          to: c.router,
          value: 0n,
          data: encodeFunctionData({
            abi: routerAbi,
            functionName: "exactInputSingle",
            args: [
              {
                tokenIn: c.usdc,
                tokenOut: c.eurc,
                fee: 100,
                recipient: session.account.address,
                deadline: BigInt(Math.floor(Date.now() / 1000) + 300),
                amountIn: input,
                amountOutMinimum: (quoteInput.result[0] * 997n) / 1000n,
                sqrtPriceLimitX96: 0n,
              },
            ],
          }),
        },
        approve(c.usdc, c.router, 0n),
        approve(c.usdc, invoiceGateway, 0n),
        approve(c.usdc, invoiceGateway, original.maxUsdcAmount),
      ]),
      { kind: "rate-demo" },
    );
    state.shockHash = receipt.receipt.transactionHash;
    save(session, state);
    onEvent(
      "Test pool price changed",
      "A real swap moved the test pool price by approximately 0.5%.",
      state.shockHash,
    );
    const moved = await getPoolQuote(original.eurAmount);
    if (moved.usdcAmount <= original.maxUsdcAmount)
      throw new Error(
        "The new quote did not exceed the 0.3% limit. Protection was not demonstrated.",
      );
    let rejected = false;
    try {
      await publicClient.simulateContract({
        address: invoiceGateway,
        account: session.account.address,
        abi: gatewayAbi,
        functionName: "payInvoice",
        args: [
          `0x${"ab".repeat(32)}`,
          original.eurAmount,
          original.maxUsdcAmount,
          BigInt(Math.floor(original.expiresAt / 1000)),
        ],
      });
    } catch (error) {
      const revert =
        error instanceof BaseError
          ? error.walk((e) => e instanceof ContractFunctionRevertedError)
          : null;
      const reason =
        revert instanceof ContractFunctionRevertedError
          ? revert.reason
          : undefined;
      // The gateway funds/approves only the agreed cap. Uniswap's callback can
      // hit that token budget (STF) before its final "Too much requested" check.
      // We already verified that the actual executable quote exceeds this cap.
      if (reason === "Too much requested" || reason === "STF") rejected = true;
      else
        throw new Error(
          `The contract check failed for another reason (${reason || "unknown response"}). Rate protection has not been verified.`,
        );
    }
    if (!rejected)
      throw new Error(
        "The protected invoice unexpectedly passed its contract check.",
      );
    state.protectionVerified = true;
    save(session, state);
    onEvent(
      "Rate protection verified",
      "The old invoice exceeded its 0.3% cap. The contract rejected it during simulation; no invoice transaction was broadcast.",
    );
  } finally {
    if (!loadPending(session.account.address)) {
      const restored = await restorePool(session);
      if (restored)
        onEvent(
          "Test pool restored",
          "A reverse swap returned the test pool close to its original price. Test swap fees remain.",
          restored,
        );
    }
  }
}
