import { parseAbi, type Address, type Hex } from "viem";
import { publicClient, verifyDeployment } from "./chain";
import { invoiceGateway, paymentHistoryStartBlock } from "./config";
import { paymentActivities, type Activity } from "./payment";

const invoiceEvent = parseAbi([
  "event InvoicePaid(address indexed account,bytes32 indexed invoiceId,uint256 euros,uint256 dollars)",
])[0];

export async function readPaymentHistory(
  account: Address,
): Promise<Activity[]> {
  if (!invoiceGateway) return [];
  await verifyDeployment();
  const latest = await publicClient.getBlockNumber();
  if (paymentHistoryStartBlock > latest) return [];
  const logs = await publicClient.getLogs({
    address: invoiceGateway,
    event: invoiceEvent,
    args: { account },
    fromBlock: paymentHistoryStartBlock,
    toBlock: latest,
    strict: true,
  });
  // The immutable gateway emits this event only after an exact-output Uniswap
  // swap and supplier delivery succeed. Never reconstruct simulated bank payouts.
  const payments = new Map<
    Hex,
    { euros: bigint; dollars: bigint; block: bigint }
  >();
  for (const log of logs) {
    if (log.removed || !log.transactionHash || log.blockNumber === null)
      continue;
    const previous = payments.get(log.transactionHash);
    payments.set(log.transactionHash, {
      euros: (previous?.euros || 0n) + log.args.euros,
      dollars: (previous?.dollars || 0n) + log.args.dollars,
      block: log.blockNumber,
    });
  }
  const recent = [...payments.entries()].slice(-25).reverse();
  return (
    await Promise.all(
      recent.map(async ([hash, payment]) => {
        const block = await publicClient.getBlock({
          blockNumber: payment.block,
        });
        return paymentActivities({
          euros: payment.euros,
          dollars: payment.dollars,
          hash,
          simulated: false,
          time: Number(block.timestamp) * 1000,
        }).reverse();
      }),
    )
  ).flat();
}
