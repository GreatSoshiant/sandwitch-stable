import { existsSync } from "node:fs";
import { spawn } from "node:child_process";

if (!existsSync(".vercel/project.json")) {
  throw new Error(
    "Link the intended Vercel project before syncing its environment.",
  );
}
process.loadEnvFile(".env.local");

// Deliberate allowlist: deployment signing keys never leave this computer.
const publicNames = [
  "NEXT_PUBLIC_ZERODEV_RPC_URL",
  "NEXT_PUBLIC_ZERODEV_PASSKEY_SERVER_URL",
  "NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL",
  "NEXT_PUBLIC_USDC_ADDRESS",
  "NEXT_PUBLIC_EURC_ADDRESS",
  "NEXT_PUBLIC_SWAP_ROUTER_ADDRESS",
  "NEXT_PUBLIC_QUOTER_ADDRESS",
  "NEXT_PUBLIC_POOL_ADDRESS",
  "NEXT_PUBLIC_SUPPLIER_ADDRESS",
  "NEXT_PUBLIC_PAYMENT_GATEWAY_ADDRESS",
  "NEXT_PUBLIC_PAYMENT_HISTORY_START_BLOCK",
  "NEXT_PUBLIC_BACKUP_VALIDATOR_FACTORY_ADDRESS",
  "NEXT_PUBLIC_ENABLE_TEST_FAUCET",
  "NEXT_PUBLIC_ENTERPRISE_CONTACT_URL",
];
const target = process.argv[2] || "production";
if (!["production", "preview"].includes(target)) {
  throw new Error("Target must be production or preview.");
}
const environment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([name]) => !/PRIVATE_KEY|MNEMONIC/.test(name),
  ),
);
const names = publicNames.filter((name) => process.env[name]);
if (
  !names.includes("NEXT_PUBLIC_ZERODEV_RPC_URL") ||
  !names.includes("NEXT_PUBLIC_POOL_ADDRESS")
) {
  throw new Error(
    "Live wallet and contract configuration is required before publishing.",
  );
}

for (const name of names) {
  await new Promise((resolve, reject) => {
    const child = spawn(
      "npx",
      [
        "--yes",
        "--cache",
        "/private/tmp/tidewater-npm-cache",
        "vercel",
        "env",
        "add",
        name,
        "--environment",
        target,
        "--type",
        "config",
        "--yes",
        "--force",
      ],
      {
        env: environment,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    // Capture no values in stdout/stderr; report only which configuration name failed.
    child.stdout.resume();
    child.stderr.resume();
    child.on("error", () =>
      reject(new Error(`Could not start Vercel CLI for ${name}.`)),
    );
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `Vercel could not save ${name}. Check project access and the CLI environment command.`,
            ),
          ),
    );
    child.stdin.on("error", () => {});
    child.stdin.end(`${process.env[name]}\n`);
  });
  console.log(`Configured ${name} for ${target}.`);
}
console.log(
  "Public configuration synchronized. No deployer private key was sent.",
);
