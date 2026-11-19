import { writeFileSync } from "node:fs";
import { formatUnits, parseAbi } from "viem";
import { getPoolQuote, publicClient, verifyDeployment } from "../src/lib/chain";
import { safeDeploymentError } from "./lib/deployment-state";

async function main() {
  const config = await verifyDeployment();
  const liquidity = await publicClient.readContract({
    address: config.pool,
    abi: parseAbi(["function liquidity() view returns (uint128)"]),
    functionName: "liquidity",
  });
  if (!liquidity) throw new Error("The pool has no active liquidity.");
  const quote = await getPoolQuote(1_000_000_000n);
  const report = {
    chainId: 421614,
    checkedAt: new Date().toISOString(),
    blockNumber: (await publicClient.getBlockNumber()).toString(),
    contracts: config,
    activeLiquidity: liquidity.toString(),
    example: {
      eurcOut: "1000",
      usdcIn: formatUnits(quote.usdcAmount, 6),
      maxUsdcIn: formatUnits(quote.maxUsdcAmount, 6),
      allowance: "0.3%",
    },
    zeroDevConfigured: Boolean(
      process.env.NEXT_PUBLIC_ZERODEV_RPC_URL &&
      process.env.NEXT_PUBLIC_ZERODEV_PASSKEY_SERVER_URL,
    ),
    note: "Contract identity, liquidity and exact-output quote verified. This read-only check does not verify passkey authentication or gas sponsorship.",
  };
  writeFileSync(
    "deployments/arbitrum-sepolia-verification.json",
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report, null, 2));
}
main().catch((error) => {
  console.error(safeDeploymentError(error));
  process.exitCode = 1;
});
