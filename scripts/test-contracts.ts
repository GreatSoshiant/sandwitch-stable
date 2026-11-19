import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  http,
  parseAbi,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { arbitrumSepolia } from "viem/chains";
import solc from "solc";

// Runs real Uniswap bytecode on a disposable local chain, using unlocked Anvil
// accounts. No external RPC, deployer secret, or real testnet transaction.
const url = "http://127.0.0.1:18545";
const anvil = spawn(
  "anvil",
  ["--port", "18545", "--chain-id", "421614", "--silent"],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let spawnError: Error | null = null;
anvil.on("error", (error) => {
  spawnError = error;
});
const client = createPublicClient({
  chain: arbitrumSepolia,
  transport: http(url, { retryCount: 0 }),
});
try {
  for (let i = 0; i < 50; i++) {
    if (spawnError)
      throw new Error(
        "Install Foundry/Anvil to run contract integration tests.",
        { cause: spawnError },
      );
    try {
      await client.getBlockNumber();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const rpcWallet = createWalletClient({
    chain: arbitrumSepolia,
    transport: http(url),
  });
  const [account, supplier, weth] = await rpcWallet.getAddresses();
  const wallet = createWalletClient({
    account,
    chain: arbitrumSepolia,
    transport: http(url),
  });
  async function mined(hash: Hex) {
    const receipt = await client.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, "success");
    return receipt;
  }
  async function deploy(
    abi: Abi,
    bytecode: Hex,
    args: readonly unknown[] = [],
  ) {
    const receipt = await mined(
      await wallet.deployContract({ abi, bytecode, args }),
    );
    assert.ok(receipt.contractAddress);
    return receipt.contractAddress;
  }
  const harness = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract MockBackupValidator { mapping(address=>uint256) public key; function onInstall(bytes calldata data) external {key[msg.sender]=abi.decode(data,(uint256));} }
contract BatchHarness {
  struct Call { address to; bytes data; uint256 value; }
  function execute(Call[] calldata calls) external {
    for (uint i; i < calls.length; ++i) {
      (bool success, bytes memory result) = calls[i].to.call{value:calls[i].value}(calls[i].data);
      if (!success) { assembly { revert(add(result,32),mload(result)) } }
    }
  }
}`;
  const compilation = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: "Solidity",
        sources: {
          "DemoToken.sol": {
            content: readFileSync(
              new URL("../contracts/DemoToken.sol", import.meta.url),
              "utf8",
            ),
          },
          "BatchHarness.sol": { content: harness },
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
  assert.equal(
    compilation.errors?.filter(
      (e: { severity: string }) => e.severity === "error",
    ).length || 0,
    0,
  );
  const mockArtifact =
    compilation.contracts["BatchHarness.sol"].MockBackupValidator;
  const target = await deploy(
    mockArtifact.abi,
    `0x${mockArtifact.evm.bytecode.object}`,
  );
  const factoryCode =
    compilation.contracts["BackupValidatorFactory.sol"].BackupValidatorFactory;
  const backupFactory = await deploy(
    factoryCode.abi,
    `0x${factoryCode.evm.bytecode.object}`,
    [target],
  );
  const clones: Address[] = [];
  for (const digit of ["11", "22"]) {
    const salt = `0x${digit.repeat(32)}` as Hex;
    const address = (await client.readContract({
      address: backupFactory,
      abi: factoryCode.abi,
      functionName: "predict",
      args: [salt],
    })) as Address;
    await mined(
      await wallet.writeContract({
        address: backupFactory,
        abi: factoryCode.abi,
        functionName: "deploy",
        args: [salt],
      }),
    );
    clones.push(address);
    await mined(
      await wallet.writeContract({
        address,
        abi: mockArtifact.abi,
        functionName: "onInstall",
        args: [`0x${BigInt(digit).toString(16).padStart(64, "0")}`],
      }),
    );
    assert.equal(
      await client.readContract({
        address,
        abi: mockArtifact.abi,
        functionName: "key",
        args: [account],
      }),
      BigInt(digit),
    );
  }
  assert.notEqual(clones[0], clones[1]);
  assert.equal(
    await client.readContract({
      address: clones[0],
      abi: mockArtifact.abi,
      functionName: "key",
      args: [account],
    }),
    11n,
  );
  assert.equal(
    await client.readContract({
      address: target,
      abi: mockArtifact.abi,
      functionName: "key",
      args: [account],
    }),
    0n,
  );
  console.log(
    "PASS: deterministic backup proxies preserve independent key storage and leave the implementation unchanged.",
  );
  const tokenArtifact = compilation.contracts["DemoToken.sol"].DemoToken;
  const usdc = await deploy(
    tokenArtifact.abi,
    `0x${tokenArtifact.evm.bytecode.object}`,
    ["Test dollar", "tUSDC"],
  );
  const eurc = await deploy(
    tokenArtifact.abi,
    `0x${tokenArtifact.evm.bytecode.object}`,
    ["Test euro", "tEURC"],
  );
  const harnessArtifact =
    compilation.contracts["BatchHarness.sol"].BatchHarness;
  const smartAccount = await deploy(
    harnessArtifact.abi,
    `0x${harnessArtifact.evm.bytecode.object}`,
  );
  const require = createRequire(import.meta.url);
  const artifact = (name: string): { abi: Abi; bytecode: Hex } => require(name);
  const factoryArtifact = artifact(
    "@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json",
  );
  const routerArtifact = artifact(
    "@uniswap/v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json",
  );
  const quoterArtifact = artifact(
    "@uniswap/v3-periphery/artifacts/contracts/lens/QuoterV2.sol/QuoterV2.json",
  );
  const managerArtifact = artifact(
    "@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json",
  );
  const factory = await deploy(factoryArtifact.abi, factoryArtifact.bytecode);
  await mined(
    await wallet.writeContract({
      address: factory,
      abi: parseAbi(["function enableFeeAmount(uint24,int24)"]),
      functionName: "enableFeeAmount",
      args: [100, 1],
    }),
  );
  const router = await deploy(routerArtifact.abi, routerArtifact.bytecode, [
    factory,
    weth,
  ]);
  const quoter = await deploy(quoterArtifact.abi, quoterArtifact.bytecode, [
    factory,
    weth,
  ]);
  const gatewayArtifact =
    compilation.contracts["InvoiceGateway.sol"].InvoiceGateway;
  const gateway = await deploy(
    gatewayArtifact.abi,
    `0x${gatewayArtifact.evm.bytecode.object}`,
    [usdc, eurc, router, supplier],
  );
  const manager = await deploy(managerArtifact.abi, managerArtifact.bytecode, [
    factory,
    weth,
    zeroAddress,
  ]);
  const [token0, token1] = [usdc, eurc].sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase()),
  );
  await mined(
    await wallet.writeContract({
      address: manager,
      abi: managerArtifact.abi,
      functionName: "createAndInitializePoolIfNecessary",
      args: [token0, token1, 100, 2n ** 96n],
    }),
  );
  for (const token of [token0, token1])
    await mined(
      await wallet.writeContract({
        address: token,
        abi: erc20Abi,
        functionName: "approve",
        args: [manager, 1_000_000_000_000n],
      }),
    );
  await mined(
    await wallet.writeContract({
      address: manager,
      abi: managerArtifact.abi,
      functionName: "mint",
      args: [
        {
          token0,
          token1,
          fee: 100,
          tickLower: -887272,
          tickUpper: 887272,
          amount0Desired: 1_000_000_000_000n,
          amount1Desired: 1_000_000_000_000n,
          amount0Min: 0n,
          amount1Min: 0n,
          recipient: account,
          deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
        },
      ],
    }),
  );
  const pool = await client.readContract({
    address: factory,
    abi: parseAbi([
      "function getPool(address,address,uint24) view returns (address)",
    ]),
    functionName: "getPool",
    args: [usdc, eurc, 100],
  });
  await mined(
    await wallet.writeContract({
      address: usdc,
      abi: erc20Abi,
      functionName: "transfer",
      args: [smartAccount, 1_500_000_000n],
    }),
  );
  Object.assign(process.env, {
    NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL: url,
    NEXT_PUBLIC_USDC_ADDRESS: usdc,
    NEXT_PUBLIC_EURC_ADDRESS: eurc,
    NEXT_PUBLIC_SWAP_ROUTER_ADDRESS: router,
    NEXT_PUBLIC_QUOTER_ADDRESS: quoter,
    NEXT_PUBLIC_POOL_ADDRESS: pool,
    NEXT_PUBLIC_SUPPLIER_ADDRESS: supplier,
    NEXT_PUBLIC_PAYMENT_GATEWAY_ADDRESS: gateway,
  });
  const { getPoolQuote, paymentCalls, readBalance } =
    await import("../src/lib/chain");
  const batchAbi = parseAbi([
    "function execute((address to,bytes data,uint256 value)[] calls)",
  ]);
  const quote = await getPoolQuote(1_000_000_000n);
  const invoiceId = `0x${"13".repeat(32)}` as Hex;
  assert.ok(quote.usdcAmount < quote.maxUsdcAmount);
  await mined(
    await wallet.writeContract({
      address: smartAccount,
      abi: batchAbi,
      functionName: "execute",
      args: [paymentCalls(quote, invoiceId)],
    }),
  );
  assert.equal(
    await client.readContract({
      address: eurc,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [supplier],
    }),
    1_000_000_000n,
  );
  assert.equal(
    await readBalance(smartAccount),
    1_500_000_000n - quote.usdcAmount,
  );
  assert.equal(
    await client.readContract({
      address: usdc,
      abi: erc20Abi,
      functionName: "allowance",
      args: [smartAccount, router],
    }),
    0n,
  );
  console.log(
    "PASS: exact 1,000 EURC delivered, exact USDC debited, allowance cleared.",
  );
  const replay = await client.waitForTransactionReceipt({
    hash: await wallet.writeContract({
      address: smartAccount,
      abi: batchAbi,
      functionName: "execute",
      args: [
        paymentCalls({ ...quote, eurAmount: 1n, maxUsdcAmount: 1n }, invoiceId),
      ],
      gas: 5_000_000n,
    }),
  });
  assert.equal(replay.status, "reverted");
  for (const [owner, spender] of [
    [smartAccount, gateway],
    [gateway, router],
  ] as const)
    assert.equal(
      await client.readContract({
        address: usdc,
        abi: erc20Abi,
        functionName: "allowance",
        args: [owner, spender],
      }),
      0n,
    );
  assert.equal(
    await client.readContract({
      address: usdc,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [gateway],
    }),
    0n,
  );
  console.log(
    "PASS: invoice replay rejected; gateway refunded unused USDC and retained no allowance or funds.",
  );

  const nextQuote = await getPoolQuote(10_000_000n);
  const before = await readBalance(smartAccount);
  const tooTight = { ...nextQuote, maxUsdcAmount: 1n };
  const failed = await client.waitForTransactionReceipt({
    hash: await wallet.writeContract({
      address: smartAccount,
      abi: batchAbi,
      functionName: "execute",
      args: [paymentCalls(tooTight)],
      gas: 5_000_000n,
    }),
  });
  assert.equal(failed.status, "reverted");
  assert.equal(await readBalance(smartAccount), before);
  assert.equal(
    await client.readContract({
      address: eurc,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [supplier],
    }),
    1_000_000_000n,
  );
  assert.equal(
    await client.readContract({
      address: usdc,
      abi: erc20Abi,
      functionName: "allowance",
      args: [smartAccount, router],
    }),
    0n,
  );
  console.log(
    "PASS: spending-limit failure rolls back balance, delivery and approval atomically.",
  );

  const expired = { ...nextQuote, expiresAt: 1_000 };
  const expiredResult = await client.waitForTransactionReceipt({
    hash: await wallet.writeContract({
      address: smartAccount,
      abi: batchAbi,
      functionName: "execute",
      args: [paymentCalls(expired)],
      gas: 5_000_000n,
    }),
  });
  assert.equal(expiredResult.status, "reverted");
  assert.equal(await readBalance(smartAccount), before);
  console.log("PASS: expired quote rejected by the onchain router.");
} finally {
  anvil.kill("SIGTERM");
}
