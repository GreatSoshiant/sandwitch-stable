import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { keccak256, type Address, type Hex } from "viem";

export type DeploymentState = {
  chainId: 421614;
  deployer: Address;
  existingEurc?: Address;
  usdPerEuro: number;
  contracts: Record<string, { address: Address; bytecodeHash: Hex }>;
  transactions: Record<string, Hex>;
  supplier?: Address;
  completed: boolean;
};

export function readDeployment(
  path: string,
  deployer: Address,
  existingEurc?: Address,
): DeploymentState | null {
  if (!existsSync(path)) return null;
  const state = JSON.parse(readFileSync(path, "utf8")) as DeploymentState;
  if (
    state.chainId !== 421614 ||
    state.deployer.toLowerCase() !== deployer.toLowerCase() ||
    (state.existingEurc || "").toLowerCase() !==
      (existingEurc || "").toLowerCase()
  ) {
    throw new Error(
      "Deployment journal belongs to another account, chain, or EURC configuration. Preserve it and select a separate journal for a new deployment.",
    );
  }
  return state;
}

export function saveDeployment(path: string, state: DeploymentState) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(temporary, path);
}

export function checkArtifact(
  stored: { address: Address; bytecodeHash: Hex },
  bytecode: Hex,
) {
  if (stored.bytecodeHash !== keccak256(bytecode))
    throw new Error(
      "Contract build changed since deployment. Do not reuse this deployment journal with different bytecode.",
    );
}

export function updateLocalEnvironment(
  path: string,
  values: Record<string, string>,
) {
  const previous = existsSync(path) ? readFileSync(path, "utf8") : "";
  const remaining = new Map(Object.entries(values));
  const lines = previous
    .trimEnd()
    .split("\n")
    .map((line) => {
      const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/);
      if (!match || !remaining.has(match[1])) return line;
      const value = remaining.get(match[1])!;
      remaining.delete(match[1]);
      return `${match[1]}=${value}`;
    });
  for (const [name, value] of remaining) lines.push(`${name}=${value}`);
  writeFileSync(path, `${lines.join("\n").trimEnd()}\n`, { mode: 0o600 });
}

export function safeDeploymentError(error: unknown) {
  let message =
    error instanceof Error
      ? error.message.split("\n")[0]
      : "Deployment request failed.";
  for (const [name, value] of Object.entries(process.env)) {
    if (value && value.length > 6 && /KEY|SECRET|TOKEN|RPC|PASSKEY/.test(name))
      message = message.split(value).join("[redacted]");
  }
  return message
    .replace(/https?:\/\/[^\s]+/g, "[RPC endpoint]")
    .replace(/0x[a-fA-F0-9]{64}/g, "[hash or key redacted]");
}
