import { createKernelAccount } from "@zerodev/sdk";
import type { KernelValidator } from "@zerodev/sdk";
import { KERNEL_V3_3, getEntryPoint } from "@zerodev/sdk/constants";
import {
  toWebAuthnKey,
  WebAuthnMode,
  toPasskeyValidator,
  PasskeyValidatorContractVersion,
} from "@zerodev/passkey-validator";
import { toPermissionValidator } from "@zerodev/permissions";
import { toECDSASigner } from "@zerodev/permissions/signers";
import {
  toCallPolicy,
  toTimestampPolicy,
  toRateLimitPolicy,
  ParamCondition,
  CallPolicyVersion,
} from "@zerodev/permissions/policies";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import {
  concatHex,
  pad,
  encodeFunctionData,
  erc20Abi,
  isAddress,
  parseAbi,
  toHex,
  encodeAbiParameters,
  keccak256,
  toFunctionSelector,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { publicClient, gatewayAbi, verifyDeployment } from "./chain";
import { invoiceGateway, passkeyServer, backupFactory } from "./config";
import { makeWalletSession, type WalletSession } from "./wallet";
import { submitOperation } from "./operations";

const entryPoint = getEntryPoint("0.7");
type WebKey = Awaited<ReturnType<typeof toWebAuthnKey>>;
export type RecoveryKit = {
  version: 1;
  chainId: 421614;
  account: Address;
  permissionId: Hex;
  credentialId: string;
  credentialHash: Hex;
  pubX: string;
  pubY: string;
  rpID: string;
};
const registryKey = "tidewater:backup-passkeys:v1";
export function recoveryKits(): RecoveryKit[] {
  return JSON.parse(localStorage.getItem(registryKey) || "[]");
}
export function saveRecoveryKit(kit: RecoveryKit) {
  localStorage.setItem(
    registryKey,
    JSON.stringify([
      ...recoveryKits().filter((k) => k.credentialHash !== kit.credentialHash),
      kit,
    ]),
  );
}
export function parseRecoveryKit(input: string): RecoveryKit {
  const k = JSON.parse(input) as RecoveryKit;
  if (
    k.version !== 1 ||
    k.chainId !== 421614 ||
    !isAddress(k.account) ||
    !isAddress(k.permissionId) ||
    !/^0x[0-9a-fA-F]{64}$/.test(k.credentialHash) ||
    !k.credentialId ||
    !/^\d+$/.test(k.pubX) ||
    !/^\d+$/.test(k.pubY) ||
    k.rpID !== location.hostname
  )
    throw new Error(
      "This is not a recovery file for this Tidewater domain and network.",
    );
  return k;
}
const factoryAbi = parseAbi([
  "function deploy(bytes32 salt) returns(address)",
  "function predict(bytes32 salt) view returns(address)",
]);
const moduleAbi = parseAbi([
  "function isModuleInstalled(uint256,address,bytes) view returns(bool)",
  "function currentNonce() view returns(uint32)",
]);
const backupSalt = (key: WebKey, account: Address) =>
  keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "bytes32" }],
      [account, key.authenticatorIdHash],
    ),
  );
async function backupValidator(key: WebKey, account: Address) {
  if (!backupFactory) throw new Error("Backup access has not been configured.");
  const address = await publicClient.readContract({
    address: backupFactory,
    abi: factoryAbi,
    functionName: "predict",
    args: [backupSalt(key, account)],
  });
  const validator = await toPasskeyValidator(publicClient, {
    webAuthnKey: key,
    entryPoint,
    kernelVersion: KERNEL_V3_3,
    validatorContractVersion: PasskeyValidatorContractVersion.V0_0_3_PATCHED,
    validatorAddress: address,
  });
  validator.isEnabled = async (accountAddress) =>
    publicClient
      .readContract({
        address: accountAddress,
        abi: moduleAbi,
        functionName: "isModuleInstalled",
        args: [1n, address, "0x"],
      })
      .catch(() => false);
  return validator;
}
export async function restoreKnownPasskey(
  key: WebKey,
): Promise<WalletSession | null> {
  const kit = recoveryKits().find(
    (k) => k.credentialHash === key.authenticatorIdHash,
  );
  if (!kit) return null;
  const validator = await backupValidator(key, kit.account);
  if (
    validator.getIdentifier() !== kit.permissionId ||
    !(await validator.isEnabled(kit.account, "0x"))
  )
    throw new Error(
      "This backup passkey is not enabled on that account. Use your primary passkey or another backup.",
    );
  const account = await createKernelAccount(publicClient, {
    address: kit.account,
    plugins: { regular: validator },
    entryPoint,
    kernelVersion: KERNEL_V3_3,
  });
  return makeWalletSession(account, validator, key, "backup");
}
export async function recoverWithFile(input: string) {
  const kit = parseRecoveryKit(input);
  // Import public metadata before authenticating; the file itself cannot sign.
  const key = await toWebAuthnKey({
    passkeyName: "Tidewater backup",
    passkeyServerUrl: passkeyServer,
    mode: WebAuthnMode.Login,
  });
  if (
    key.authenticatorIdHash !== kit.credentialHash ||
    key.pubX.toString() !== kit.pubX ||
    key.pubY.toString() !== kit.pubY
  )
    throw new Error("Choose the backup passkey matching this recovery file.");
  saveRecoveryKit(kit);
  return (await restoreKnownPasskey(key))!;
}
export async function addBackup(session: WalletSession) {
  if (!backupFactory) throw new Error("Backup access has not been configured.");
  const key = await toWebAuthnKey({
    passkeyName: "Tidewater · backup access",
    passkeyServerUrl: passkeyServer,
    mode: WebAuthnMode.Register,
  });
  if (key.authenticatorIdHash === session.webAuthnKey.authenticatorIdHash)
    throw new Error("Choose a different backup passkey.");
  const validator = await backupValidator(key, session.account.address);
  const id = concatHex(["0x01", validator.address]);
  const nonce = await publicClient
    .readContract({
      address: session.account.address,
      abi: moduleAbi,
      functionName: "currentNonce",
    })
    .catch(() => 1);
  const installAbi = parseAbi([
    "function installValidations(bytes21[],(uint32 nonce,address hook)[],bytes[],bytes[])",
    "function grantAccess(bytes21,bytes4,bool)",
  ]);
  const kit: RecoveryKit = {
    version: 1,
    chainId: 421614,
    account: session.account.address,
    permissionId: validator.address,
    credentialId: key.authenticatorId,
    credentialHash: key.authenticatorIdHash,
    pubX: key.pubX.toString(),
    pubY: key.pubY.toString(),
    rpID: location.hostname,
  };
  saveRecoveryKit(kit);
  const receipt = await submitOperation(
    session,
    await session.account.encodeCalls([
      {
        to: backupFactory,
        value: 0n,
        data: encodeFunctionData({
          abi: factoryAbi,
          functionName: "deploy",
          args: [backupSalt(key, session.account.address)],
        }),
      },
      {
        to: session.account.address,
        value: 0n,
        data: encodeFunctionData({
          abi: installAbi,
          functionName: "installValidations",
          args: [
            [id],
            [{ nonce: nonce || 1, hook: zeroAddress }],
            [await validator.getEnableData(session.account.address)],
            ["0x"],
          ],
        }),
      },
      {
        to: session.account.address,
        value: 0n,
        data: encodeFunctionData({
          abi: installAbi,
          functionName: "grantAccess",
          args: [id, toFunctionSelector("execute(bytes32,bytes)"), true],
        }),
      },
    ]),
    { kind: "security" },
  );
  if (!(await validator.isEnabled(session.account.address, "0x")))
    throw new Error(
      "Backup activation is not yet verified. Check operation status before relying on it.",
    );
  return { kit, hash: receipt.receipt.transactionHash };
}
const kernelAbi = parseAbi([
  "function uninstallValidation(bytes21 vId,bytes deinitData,bytes hookDeinitData)",
]);
export async function removePermission(
  session: WalletSession,
  id: Hex,
  permission?: KernelValidator,
) {
  if (!permission) {
    const kit = recoveryKits().find(
      (k) =>
        k.account.toLowerCase() === session.account.address.toLowerCase() &&
        k.permissionId === id,
    );
    if (!kit)
      throw new Error(
        "Permission details are needed to revoke this access safely.",
      );
    permission = await backupValidator(
      {
        pubX: BigInt(kit.pubX),
        pubY: BigInt(kit.pubY),
        authenticatorId: kit.credentialId,
        authenticatorIdHash: kit.credentialHash,
        rpID: kit.rpID,
      },
      session.account.address,
    );
  }
  const deinitData = await permission.getEnableData(session.account.address);
  const receipt = await submitOperation(
    session,
    await session.account.encodeCalls([
      {
        to: session.account.address,
        value: 0n,
        data: encodeFunctionData({
          abi: kernelAbi,
          functionName: "uninstallValidation",
          args: [
            concatHex([
              permission.validatorType === "PERMISSION" ? "0x02" : "0x01",
              pad(id, { size: 20, dir: "right" }),
            ]),
            deinitData,
            "0x",
          ],
        }),
      },
    ]),
    { kind: "security" },
  );
  return receipt.receipt.transactionHash;
}

export const SESSION_EURO_CAP = 1_000_000_000n;
export const SESSION_USDC_CAP = 1_500_000_000n;
export type LimitedSession = {
  wallet: WalletSession;
  invoiceId: Hex;
  permissionId: Hex;
  expiresAt: number;
  used: boolean;
};
export function sessionPolicies(
  usdc: Address,
  gateway: Address,
  invoiceId: Hex,
  expiresAt: number,
) {
  return [
    toCallPolicy({
      policyVersion: CallPolicyVersion.V0_0_4,
      permissions: [
        {
          target: usdc,
          valueLimit: 0n,
          abi: erc20Abi,
          functionName: "approve",
          args: [
            { condition: ParamCondition.EQUAL, value: gateway },
            {
              condition: ParamCondition.LESS_THAN_OR_EQUAL,
              value: SESSION_USDC_CAP,
            },
          ],
        },
        {
          target: gateway,
          valueLimit: 0n,
          abi: gatewayAbi,
          functionName: "payInvoice",
          args: [
            { condition: ParamCondition.EQUAL, value: invoiceId },
            {
              condition: ParamCondition.LESS_THAN_OR_EQUAL,
              value: SESSION_EURO_CAP,
            },
            {
              condition: ParamCondition.LESS_THAN_OR_EQUAL,
              value: SESSION_USDC_CAP,
            },
            {
              condition: ParamCondition.LESS_THAN_OR_EQUAL,
              value: BigInt(Math.floor(expiresAt / 1000)),
            },
          ],
        },
      ],
    }),
    toTimestampPolicy({ validUntil: Math.floor(expiresAt / 1000) }),
    toRateLimitPolicy({ count: 1, interval: 0 }),
  ];
}
export async function enableLimitedSession(
  owner: WalletSession,
): Promise<LimitedSession> {
  const config = await verifyDeployment();
  if (!invoiceGateway)
    throw new Error("Limited sessions need the deployed invoice gateway.");
  const expiresAt = Date.now() + 15 * 60_000;
  const invoiceId = toHex(crypto.getRandomValues(new Uint8Array(32)));
  // Ephemeral key exists ONLY inside this object; never exported or persisted.
  const signer = await toECDSASigner({
    signer: privateKeyToAccount(generatePrivateKey()),
  });
  const validator = await toPermissionValidator(publicClient, {
    entryPoint,
    kernelVersion: KERNEL_V3_3,
    signer,
    policies: sessionPolicies(
      config.usdc,
      invoiceGateway,
      invoiceId,
      expiresAt,
    ),
  });
  const account = await createKernelAccount(publicClient, {
    address: owner.account.address,
    plugins: { sudo: owner.validator, regular: validator },
    entryPoint,
    kernelVersion: KERNEL_V3_3,
  });
  await account.kernelPluginManager.getPluginEnableSignature(account.address);
  return {
    wallet: makeWalletSession(
      account,
      validator,
      owner.webAuthnKey,
      owner.access,
    ),
    invoiceId,
    permissionId: validator.getIdentifier(),
    expiresAt,
    used: false,
  };
}
