import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { keccak256 } from "viem";
import {
  checkArtifact,
  readDeployment,
  saveDeployment,
  updateLocalEnvironment,
  safeDeploymentError,
  type DeploymentState,
} from "../scripts/lib/deployment-state";

const directories: string[] = [];
function directory() {
  const path = mkdtempSync(join(tmpdir(), "tidewater-deployment-"));
  directories.push(path);
  return path;
}
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true });
});

describe("deployment configuration and resume guards", () => {
  it("updates only public values, preserving the private key and comments", () => {
    const path = join(directory(), ".env.local");
    writeFileSync(
      path,
      "# local configuration\nDEPLOYER_PRIVATE_KEY=do-not-print-this-fixture\nNEXT_PUBLIC_POOL_ADDRESS=old\n",
    );
    updateLocalEnvironment(path, {
      NEXT_PUBLIC_POOL_ADDRESS: "new",
      NEXT_PUBLIC_EURC_ADDRESS: "euro",
    });
    expect(readFileSync(path, "utf8")).toBe(
      "# local configuration\nDEPLOYER_PRIVATE_KEY=do-not-print-this-fixture\nNEXT_PUBLIC_POOL_ADDRESS=new\nNEXT_PUBLIC_EURC_ADDRESS=euro\n",
    );
  });
  it("refuses to resume another wallet's deployment", () => {
    const path = join(directory(), "deployment.json");
    const state: DeploymentState = {
      chainId: 421614,
      deployer: "0x1111111111111111111111111111111111111111",
      usdPerEuro: 1.08,
      contracts: {},
      transactions: {},
      completed: false,
    };
    saveDeployment(path, state);
    expect(readDeployment(path, state.deployer)).toEqual(state);
    expect(() =>
      readDeployment(path, "0x2222222222222222222222222222222222222222"),
    ).toThrow(/another account/);
    expect(() =>
      readDeployment(
        path,
        state.deployer,
        "0x3333333333333333333333333333333333333333",
      ),
    ).toThrow(/another account/);
  });
  it("rejects changed contract artifacts on resume", () => {
    const stored = {
      address: "0x1111111111111111111111111111111111111111" as const,
      bytecodeHash: keccak256("0x1234"),
    };
    expect(() => checkArtifact(stored, "0x1234")).not.toThrow();
    expect(() => checkArtifact(stored, "0xabcd")).toThrow(/build changed/);
  });
  it("redacts endpoint URLs and key-shaped values from errors", () => {
    const key = `0x${"ab".repeat(32)}`;
    const result = safeDeploymentError(
      new Error(
        `Failed at https://rpc.example/key/${key}\nRequest body: sensitive`,
      ),
    );
    expect(result).not.toContain(key);
    expect(result).not.toContain("https://");
    expect(result).not.toContain("Request body");
  });
});
