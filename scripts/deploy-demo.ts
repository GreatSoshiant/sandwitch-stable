import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  encodeDeployData,
  encodeFunctionData,
  erc20Abi,
  formatEther,
  http,
  isAddress,
  keccak256,
  parseAbi,
  parseEther,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { createKernelAccount } from "@zerodev/sdk";
import { KERNEL_V3_3, getEntryPoint } from "@zerodev/sdk/constants";
import {
  getValidatorAddress,
  PasskeyValidatorContractVersion,
} from "@zerodev/passkey-validator";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import solc from "solc";
import {
  checkArtifact,
  readDeployment,
  saveDeployment,
  updateLocalEnvironment,
  safeDeploymentError,
  type DeploymentState,
} from "./lib/deployment-state";

// Never log the environment, signing key, signed payload, or raw RPC errors.
async function main() {
  const suppliedKey = process.env.DEPLOYER_PRIVATE_KEY?.trim();
  const key =
    suppliedKey && /^[0-9a-fA-F]{64}$/.test(suppliedKey)
      ? `0x${suppliedKey}`
      : suppliedKey;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key))
    throw new Error(
      "Set DEPLOYER_PRIVATE_KEY in ignored .env.local to a funded Arbitrum Sepolia test account.",
    );
  const account = privateKeyToAccount(key as Hex);
  const transport = http(
    process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL ||
      arbitrumSepolia.rpcUrls.default.http[0],
    { timeout: 30_000, retryCount: 2 },
  );
  const client = createPublicClient({ chain: arbitrumSepolia, transport });
  const wallet = createWalletClient({
    account,
    chain: arbitrumSepolia,
    transport,
  });
  if ((await client.getChainId()) !== 421614)
    throw new Error("Deployment is restricted to Arbitrum Sepolia (421614).");
  const balance = await client.getBalance({ address: account.address });
  console.log(
    `Deployer: ${account.address}\nNetwork: Arbitrum Sepolia (421614)\nBalance: ${formatEther(balance)} test ETH`,
  );
  const maxCost = parseEther(process.env.DEPLOYMENT_MAX_COST_ETH || "0.02");
  const existing = process.env.EXISTING_EURC_ADDRESS;
  if (existing && !isAddress(existing))
    throw new Error("EXISTING_EURC_ADDRESS must be a valid address.");
  const journal = resolve(
    process.env.DEPLOYMENT_JOURNAL || "deployments/arbitrum-sepolia.json",
  );
  let state = readDeployment(
    journal,
    account.address,
    existing as Address | undefined,
  );
  let usdPerEuro = state?.usdPerEuro || 1.08;
  if (!state) {
    try {
      const headers = process.env.COINGECKO_DEMO_API_KEY
        ? { "x-cg-demo-api-key": process.env.COINGECKO_DEMO_API_KEY }
        : undefined;
      const response = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=euro-coin&vs_currencies=usd",
        { headers, signal: AbortSignal.timeout(6000) },
      );
      const value = (await response.json())["euro-coin"]?.usd;
      if (!response.ok || !Number.isFinite(value) || value <= 0)
        throw new Error();
      usdPerEuro = value;
    } catch {
      console.log(
        "Reference feed unavailable; initializing with illustrative 1 EUR = 1.08 USD.",
      );
    }
  }
  const seed = 1_000_000n * 1_000_000n;
  if (existing && !state?.completed) {
    const [decimals, tokenBalance] = await Promise.all([
      client.readContract({
        address: existing as Address,
        abi: erc20Abi,
        functionName: "decimals",
      }),
      client.readContract({
        address: existing as Address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account.address],
      }),
    ]);
    if (decimals !== 6)
      throw new Error("Existing test EURC must use six decimals.");
    if (!state?.transactions["seed-pool"] && tokenBalance < seed)
      throw new Error(
        "The deployer needs 1,000,000 existing test EURC to seed the pool.",
      );
  }
  const gasPrice = await client.getGasPrice();
  const reserve = gasPrice * 2n * 35_000_000n;
  console.log(
    `Conservative gas reserve: ${formatEther(reserve)} test ETH\nDeployment spending ceiling: ${formatEther(maxCost)} test ETH`,
  );
  if (!state?.completed && (balance < reserve || reserve > maxCost))
    throw new Error(
      "Balance or spending ceiling is below the conservative gas reserve. No new transactions sent.",
    );
  if (process.argv.includes("--check")) {
    console.log(
      `Deployment preflight passed. ZeroDev RPC: ${process.env.NEXT_PUBLIC_ZERODEV_RPC_URL ? "set" : "not set"}; passkey server: ${process.env.NEXT_PUBLIC_ZERODEV_PASSKEY_SERVER_URL ? "set" : "not set"}.`,
    );
    return;
  }
  if (!state) {
    state = {
      chainId: 421614,
      deployer: account.address,
      existingEurc: existing as Address | undefined,
      usdPerEuro,
      contracts: {},
      transactions: {},
      completed: false,
    };
    saveDeployment(journal, state);
  }
  const deployment: DeploymentState = state;
  let spent = 0n;
  for (const hash of Object.values(deployment.transactions)) {
    const receipt = await client
      .getTransactionReceipt({ hash })
      .catch(() => null);
    if (receipt) spent += receipt.gasUsed * receipt.effectiveGasPrice;
  }
  async function transact(id: string, data: Hex, to?: Address) {
    const previous = deployment.transactions[id];
    if (previous) {
      console.log(`Resume ${id}: ${previous}`);
      const receipt = await client.waitForTransactionReceipt({
        hash: previous,
        timeout: 180_000,
      });
      if (receipt.status !== "success")
        throw new Error(
          `Step ${id} previously reverted. Inspect its recorded transaction before resuming.`,
        );
      return receipt;
    }
    const estimate = await client.estimateGas({
      account: account.address,
      to,
      data,
    });
    const gas = (estimate * 125n + 99n) / 100n;
    const feeCap = (await client.getGasPrice()) * 2n;
    if (spent + gas * feeCap > maxCost)
      throw new Error(
        `Step ${id} would exceed the deployment gas spending ceiling.`,
      );
    const request = await wallet.prepareTransactionRequest({
      account,
      to,
      data,
      gas,
      maxFeePerGas: feeCap,
      maxPriorityFeePerGas: 0n,
    });
    const signed = await wallet.signTransaction(request);
    const hash = keccak256(signed);
    deployment.transactions[id] = hash;
    // Persist BEFORE broadcasting so an RPC interruption cannot cause duplicate deployments.
    saveDeployment(journal, deployment);
    console.log(`Send ${id}: ${hash}`);
    try {
      await client.sendRawTransaction({ serializedTransaction: signed });
    } catch {
      const received = await client.getTransaction({ hash }).catch(() => null);
      if (!received)
        throw new Error(
          `Submission of ${id} is uncertain. Its hash is saved; inspect it before retrying. No replacement was sent.`,
        );
    }
    const receipt = await client.waitForTransactionReceipt({
      hash,
      timeout: 180_000,
    });
    spent += receipt.gasUsed * receipt.effectiveGasPrice;
    if (receipt.status !== "success")
      throw new Error(
        `Step ${id} reverted; its transaction is recorded in the journal.`,
      );
    return receipt;
  }
  const require = createRequire(import.meta.url);
  type Artifact = { abi: Abi; bytecode: Hex };
  const artifact = (name: string): Artifact => require(name);
  async function deploy(
    id: string,
    contract: Artifact,
    args: readonly unknown[] = [],
  ) {
    const previous = deployment.contracts[id];
    if (previous) {
      checkArtifact(previous, contract.bytecode);
      if (!(await client.getCode({ address: previous.address })))
        throw new Error(`Recorded ${id} has no code on this network.`);
      return previous.address;
    }
    const receipt = await transact(
      id,
      encodeDeployData({
        abi: contract.abi,
        bytecode: contract.bytecode,
        args,
      }),
    );
    if (!receipt.contractAddress) throw new Error(`No address for ${id}.`);
    deployment.contracts[id] = {
      address: receipt.contractAddress,
      bytecodeHash: keccak256(contract.bytecode),
    };
    saveDeployment(journal, deployment);
    console.log(`${id}: ${receipt.contractAddress}`);
    return receipt.contractAddress;
  }
  const source = readFileSync(
    new URL("../contracts/DemoToken.sol", import.meta.url),
    "utf8",
  );
  const compilation = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: "Solidity",
        sources: {
          "DemoToken.sol": { content: source },
          "BackupValidatorFactory.sol": {
            content: readFileSync(
              new URL(
                "../contracts/BackupValidatorFactory.sol",
                import.meta.url,
              ),
              "utf8",
            ),
          },
          "InvoiceGateway.sol": {
            content: readFileSync(
              new URL("../contracts/InvoiceGateway.sol", import.meta.url),
              "utf8",
            ),
          },
        },
        settings: {
          evmVersion: "paris",
          optimizer: { enabled: true, runs: 200 },
          outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
        },
      }),
    ),
  );
  if (
    compilation.errors?.some(
      (e: { severity: string }) => e.severity === "error",
    )
  )
    throw new Error("DemoToken compilation failed.");
  const compiled = compilation.contracts["DemoToken.sol"].DemoToken;
  const token: Artifact = {
    abi: compiled.abi,
    bytecode: `0x${compiled.evm.bytecode.object}`,
  };
  const weth: Address = "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73";
  const usdc = await deploy("usdc", token, ["Tidewater Test USD", "tUSDC"]);
  const eurc =
    (existing as Address) ||
    (await deploy("eurc", token, ["Tidewater Test Euro", "tEURC"]));
  const factory = await deploy(
    "factory",
    artifact(
      "@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json",
    ),
  );
  const factoryAbi = parseAbi([
    "function enableFeeAmount(uint24,int24)",
    "function getPool(address,address,uint24) view returns (address)",
  ]);
  await transact(
    "enable-fee",
    encodeFunctionData({
      abi: factoryAbi,
      functionName: "enableFeeAmount",
      args: [100, 1],
    }),
    factory,
  );
  const router = await deploy(
    "router",
    artifact(
      "@uniswap/v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json",
    ),
    [factory, weth],
  );
  const quoter = await deploy(
    "quoter",
    artifact(
      "@uniswap/v3-periphery/artifacts/contracts/lens/QuoterV2.sol/QuoterV2.json",
    ),
    [factory, weth],
  );
  const manager = await deploy(
    "manager",
    artifact(
      "@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json",
    ),
    [factory, weth, zeroAddress],
  );
  let recipient =
    deployment.supplier ||
    (process.env.NEXT_PUBLIC_SUPPLIER_ADDRESS as Address | undefined);
  if (recipient && (!isAddress(recipient) || recipient === zeroAddress))
    throw new Error("Supplier must be a nonzero address.");
  if (!recipient) {
    const entryPoint = getEntryPoint("0.7");
    const validator = await signerToEcdsaValidator(client, {
      signer: account,
      entryPoint,
      kernelVersion: KERNEL_V3_3,
    });
    const supplierAccount = await createKernelAccount(client, {
      plugins: { sudo: validator },
      entryPoint,
      kernelVersion: KERNEL_V3_3,
      index: 1n,
    });
    recipient = supplierAccount.address;
  }
  deployment.supplier = recipient;
  saveDeployment(journal, deployment);
  const gatewayCompiled =
    compilation.contracts["InvoiceGateway.sol"].InvoiceGateway;
  const gateway = await deploy(
    "invoice-gateway",
    {
      abi: gatewayCompiled.abi,
      bytecode: `0x${gatewayCompiled.evm.bytecode.object}`,
    },
    [usdc, eurc, router, recipient],
  );
  const backupCompiled =
    compilation.contracts["BackupValidatorFactory.sol"].BackupValidatorFactory;
  const backupImplementation = getValidatorAddress(
    getEntryPoint("0.7"),
    KERNEL_V3_3,
    PasskeyValidatorContractVersion.V0_0_3_PATCHED,
  );
  const backupFactory = await deploy(
    "backup-validator-factory",
    {
      abi: backupCompiled.abi,
      bytecode: `0x${backupCompiled.evm.bytecode.object}`,
    },
    [backupImplementation],
  );
  const [token0, token1] = [usdc, eurc].sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase()),
  );
  const rate = BigInt(Math.round(usdPerEuro * 1_000_000));
  const numerator = token0 === usdc ? 1_000_000n : rate;
  const denominator = token0 === usdc ? rate : 1_000_000n;
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
  const managerAbi = parseAbi([
    "function createAndInitializePoolIfNecessary(address,address,uint24,uint160) payable returns (address)",
    "function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline) params) payable returns (uint256,uint128,uint256,uint256)",
  ]);
  await transact(
    "initialize-pool",
    encodeFunctionData({
      abi: managerAbi,
      functionName: "createAndInitializePoolIfNecessary",
      args: [token0, token1, 100, sqrt((numerator << 192n) / denominator)],
    }),
    manager,
  );
  for (const [id, address] of [
    ["token0", token0],
    ["token1", token1],
  ] as const)
    await transact(
      `approve-${id}`,
      encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [manager, seed],
      }),
      address,
    );
  await transact(
    "seed-pool",
    encodeFunctionData({
      abi: managerAbi,
      functionName: "mint",
      args: [
        {
          token0,
          token1,
          fee: 100,
          tickLower: -887272,
          tickUpper: 887272,
          amount0Desired: seed,
          amount1Desired: seed,
          amount0Min: 0n,
          amount1Min: 0n,
          recipient: account.address,
          deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
        },
      ],
    }),
    manager,
  );
  for (const [id, address] of [
    ["token0", token0],
    ["token1", token1],
  ] as const)
    await transact(
      `clear-${id}`,
      encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [manager, 0n],
      }),
      address,
    );
  const pool = await client.readContract({
    address: factory,
    abi: factoryAbi,
    functionName: "getPool",
    args: [usdc, eurc, 100],
  });
  if (pool === zeroAddress) throw new Error("Factory returned no pool.");
  deployment.completed = true;
  saveDeployment(journal, deployment);
  updateLocalEnvironment(resolve(".env.local"), {
    NEXT_PUBLIC_USDC_ADDRESS: usdc,
    NEXT_PUBLIC_EURC_ADDRESS: eurc,
    NEXT_PUBLIC_SWAP_ROUTER_ADDRESS: router,
    NEXT_PUBLIC_QUOTER_ADDRESS: quoter,
    NEXT_PUBLIC_POOL_ADDRESS: pool,
    NEXT_PUBLIC_SUPPLIER_ADDRESS: recipient,
    NEXT_PUBLIC_ENABLE_TEST_FAUCET: "true",
    NEXT_PUBLIC_PAYMENT_GATEWAY_ADDRESS: gateway,
    NEXT_PUBLIC_PAYMENT_HISTORY_START_BLOCK: (
      await client.getTransactionReceipt({
        hash: deployment.transactions["invoice-gateway"],
      })
    ).blockNumber.toString(),
    NEXT_PUBLIC_BACKUP_VALIDATOR_FACTORY_ADDRESS: backupFactory,
  });
  console.log(
    `Deployment complete. Public addresses written to .env.local; private values preserved.\nPool: ${pool}\nSupplier smart account: ${recipient}\nRecorded gas expenditure: ${formatEther(spent)} test ETH\nJournal: ${journal}`,
  );
}

main().catch((error) => {
  console.error(safeDeploymentError(error));
  process.exitCode = 1;
});
