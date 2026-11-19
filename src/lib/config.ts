import { isAddress, zeroAddress, type Address } from "viem";

const fields = {
  usdc: process.env.NEXT_PUBLIC_USDC_ADDRESS,
  eurc: process.env.NEXT_PUBLIC_EURC_ADDRESS,
  router: process.env.NEXT_PUBLIC_SWAP_ROUTER_ADDRESS,
  quoter: process.env.NEXT_PUBLIC_QUOTER_ADDRESS,
  pool: process.env.NEXT_PUBLIC_POOL_ADDRESS,
  supplier: process.env.NEXT_PUBLIC_SUPPLIER_ADDRESS,
};

export const rpcUrl =
  process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL ||
  "https://sepolia-rollup.arbitrum.io/rpc";
export const zeroDevRpc = process.env.NEXT_PUBLIC_ZERODEV_RPC_URL || "";
export const passkeyServer =
  process.env.NEXT_PUBLIC_ZERODEV_PASSKEY_SERVER_URL || "";
export const invoiceGateway = process.env
  .NEXT_PUBLIC_PAYMENT_GATEWAY_ADDRESS as Address | undefined;
export const backupFactory = process.env
  .NEXT_PUBLIC_BACKUP_VALIDATOR_FACTORY_ADDRESS as Address | undefined;
export const paymentHistoryStartBlock = BigInt(
  process.env.NEXT_PUBLIC_PAYMENT_HISTORY_START_BLOCK || "330494907",
);
export const walletConfigured = Boolean(zeroDevRpc && passkeyServer);
export const paymentConfigured = Object.values(fields).every(
  (value) => value && isAddress(value) && value.toLowerCase() !== zeroAddress,
);

export function paymentConfig(): Record<keyof typeof fields, Address> {
  if (!paymentConfigured)
    throw new Error("Testnet payment contracts have not been configured yet.");
  return fields as Record<keyof typeof fields, Address>;
}

export const explorerUrl = (hash: `0x${string}`) =>
  `https://sepolia.arbiscan.io/tx/${hash}`;
