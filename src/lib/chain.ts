import {
  createPublicClient,
  http,
  erc20Abi,
  parseAbi,
  encodeFunctionData,
  type Address,
  type Hex,
  toHex,
} from "viem";
import { arbitrumSepolia } from "viem/chains";
import { paymentConfig, rpcUrl, invoiceGateway } from "./config";
import { maximumInput, QUOTE_LIFETIME_MS, type Quote } from "./payment";

export const publicClient = createPublicClient({
  chain: arbitrumSepolia,
  transport: http(rpcUrl),
});
export const poolAbi = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
  "function factory() view returns (address)",
  "function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)",
  "function liquidity() view returns (uint128)",
]);
const factoryAbi = parseAbi([
  "function getPool(address,address,uint24) view returns (address)",
]);
const factoryGetter = parseAbi(["function factory() view returns (address)"]);
export const routerAbi = parseAbi([
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
  "function exactOutputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountOut,uint256 amountInMaximum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountIn)",
]);
export const gatewayAbi = parseAbi([
  "function payInvoice(bytes32 invoiceId,uint256 euros,uint256 maxDollars,uint256 deadline) returns (uint256 spent)",
  "function paid(address,bytes32) view returns (bool)",
  "function usdc() view returns (address)",
  "function eurc() view returns (address)",
  "function router() view returns (address)",
  "function supplier() view returns (address)",
]);
export const quoterAbi = parseAbi([
  "function quoteExactOutputSingle((address tokenIn,address tokenOut,uint256 amount,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountIn,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
]);

export async function verifyDeployment() {
  const c = paymentConfig();
  if ((await publicClient.getChainId()) !== arbitrumSepolia.id)
    throw new Error("RPC must point to Arbitrum Sepolia.");
  const [
    dollarDecimals,
    euroDecimals,
    token0,
    token1,
    fee,
    factory,
    routerFactory,
    quoterFactory,
  ] = await Promise.all([
    publicClient.readContract({
      address: c.usdc,
      abi: erc20Abi,
      functionName: "decimals",
    }),
    publicClient.readContract({
      address: c.eurc,
      abi: erc20Abi,
      functionName: "decimals",
    }),
    publicClient.readContract({
      address: c.pool,
      abi: poolAbi,
      functionName: "token0",
    }),
    publicClient.readContract({
      address: c.pool,
      abi: poolAbi,
      functionName: "token1",
    }),
    publicClient.readContract({
      address: c.pool,
      abi: poolAbi,
      functionName: "fee",
    }),
    publicClient.readContract({
      address: c.pool,
      abi: poolAbi,
      functionName: "factory",
    }),
    publicClient.readContract({
      address: c.router,
      abi: factoryGetter,
      functionName: "factory",
    }),
    publicClient.readContract({
      address: c.quoter,
      abi: factoryGetter,
      functionName: "factory",
    }),
  ]);
  if (dollarDecimals !== 6 || euroDecimals !== 6)
    throw new Error("Both demo tokens must use six decimals.");
  const pair = [token0.toLowerCase(), token1.toLowerCase()];
  if (
    c.usdc.toLowerCase() === c.eurc.toLowerCase() ||
    !pair.includes(c.usdc.toLowerCase()) ||
    !pair.includes(c.eurc.toLowerCase()) ||
    fee !== 100
  ) {
    throw new Error("Configure a USDC/tEURC Uniswap v3 pool with a 0.01% fee.");
  }
  const registeredPool = await publicClient.readContract({
    address: factory,
    abi: factoryAbi,
    functionName: "getPool",
    args: [c.usdc, c.eurc, fee],
  });
  if (
    [routerFactory, quoterFactory].some(
      (f) => f.toLowerCase() !== factory.toLowerCase(),
    ) ||
    registeredPool.toLowerCase() !== c.pool.toLowerCase()
  ) {
    throw new Error(
      "Pool, router and quoter must belong to the same Uniswap v3 factory.",
    );
  }
  if (invoiceGateway) {
    const expected = [c.usdc, c.eurc, c.router, c.supplier];
    const actual = await Promise.all(
      (["usdc", "eurc", "router", "supplier"] as const).map((functionName) =>
        publicClient.readContract({
          address: invoiceGateway!,
          abi: gatewayAbi,
          functionName,
        }),
      ),
    );
    if (actual.some((a, i) => a.toLowerCase() !== expected[i].toLowerCase()))
      throw new Error(
        "Invoice gateway does not match the configured supplier and pool.",
      );
  }
  return c;
}

export async function readBalance(address: Address) {
  const c = paymentConfig();
  return publicClient.readContract({
    address: c.usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
  });
}

export async function getPoolQuote(eurAmount: bigint): Promise<Quote> {
  const c = await verifyDeployment();
  const { result } = await publicClient.simulateContract({
    address: c.quoter,
    abi: quoterAbi,
    functionName: "quoteExactOutputSingle",
    args: [
      {
        tokenIn: c.usdc,
        tokenOut: c.eurc,
        amount: eurAmount,
        fee: 100,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });
  return {
    eurAmount,
    usdcAmount: result[0],
    maxUsdcAmount: maximumInput(result[0]),
    expiresAt: Date.now() + QUOTE_LIFETIME_MS,
    source: "pool",
  };
}

export function paymentCalls(quote: Quote, invoiceId?: Hex) {
  const c = paymentConfig();
  if (invoiceGateway) {
    const id = invoiceId ?? toHex(crypto.getRandomValues(new Uint8Array(32)));
    return [0n, quote.maxUsdcAmount]
      .map((amount) => ({
        to: c.usdc,
        value: 0n,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [invoiceGateway!, amount],
        }),
      }))
      .concat([
        {
          to: invoiceGateway,
          value: 0n,
          data: encodeFunctionData({
            abi: gatewayAbi,
            functionName: "payInvoice",
            args: [
              id,
              quote.eurAmount,
              quote.maxUsdcAmount,
              BigInt(Math.floor(quote.expiresAt / 1000)),
            ],
          }),
        },
        {
          to: c.usdc,
          value: 0n,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [invoiceGateway, 0n],
          }),
        },
      ]);
  }
  return [
    {
      to: c.usdc,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [c.router, 0n],
      }),
      value: 0n,
    },
    {
      to: c.usdc,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [c.router, quote.maxUsdcAmount],
      }),
      value: 0n,
    },
    {
      to: c.router,
      data: encodeFunctionData({
        abi: routerAbi,
        functionName: "exactOutputSingle",
        args: [
          {
            tokenIn: c.usdc,
            tokenOut: c.eurc,
            fee: 100,
            recipient: c.supplier,
            deadline: BigInt(Math.floor(quote.expiresAt / 1000)),
            amountOut: quote.eurAmount,
            amountInMaximum: quote.maxUsdcAmount,
            sqrtPriceLimitX96: 0n,
          },
        ],
      }),
      value: 0n,
    },
    {
      to: c.usdc,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [c.router, 0n],
      }),
      value: 0n,
    },
  ];
}
