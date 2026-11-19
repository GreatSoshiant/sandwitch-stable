"use client";
import { useEffect, useState } from "react";
import type { Hex } from "viem";
import type { WalletSession } from "@/lib/wallet";
import {
  addBackup,
  recoveryKits,
  removePermission,
  enableLimitedSession,
  type LimitedSession,
  type RecoveryKit,
} from "@/lib/security";
import { rateDemoState, restorePool, runRateDemo } from "@/lib/rate-demo";
import { explorerUrl } from "@/lib/config";

export function AccountControls({
  session,
  busy,
  blocked,
  limited,
  onLimited,
  run,
  log,
}: {
  session: WalletSession;
  busy: boolean;
  blocked: boolean;
  limited: LimitedSession | null;
  onLimited: (value: LimitedSession | null) => void;
  run: (task: () => Promise<void>) => void;
  log: (title: string, detail: string, hash?: Hex) => void;
}) {
  const [kits, setKits] = useState<RecoveryKit[]>([]);
  const [restoreNeeded, setRestoreNeeded] = useState(false);
  const [consent, setConsent] = useState(false);
  const update = () => {
    setKits(
      recoveryKits().filter(
        (k) =>
          k.account.toLowerCase() === session.account.address.toLowerCase(),
      ),
    );
    setRestoreNeeded(Boolean(rateDemoState(session)));
  };
  useEffect(update, [session]);
  function download(kit: RecoveryKit) {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            { ...kit, rpID: kit.rpID || location.hostname },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `tidewater-recovery-${kit.account.slice(2, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="account-controls">
      <section className="panel account-panel">
        <h2>Your account</h2>
        <p className="account-address">{session.account.address}</p>
        <p>
          Signed in with your{" "}
          {session.access === "backup" ? "backup" : "primary"} passkey. Test
          tokens and transactions use Arbitrum Sepolia.
        </p>
        <p>
          To use the same account on another device, choose your synced passkey
          or an existing backup. Creating a new account makes a separate wallet.
        </p>
      </section>
      <section className="panel account-panel">
        <h2>Backup access</h2>
        <p>
          Add another passkey to this same wallet, then save its recovery file
          somewhere you can find it on another device. The file contains public
          account information; the backup passkey is still required.
        </p>
        <label className="consent">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />{" "}
          I understand that a backup passkey has full control of this wallet. I
          will choose a separate authenticator or device.
        </label>
        <button
          className="button secondary"
          disabled={busy || blocked || !consent || session.access !== "primary"}
          onClick={() =>
            run(async () => {
              try {
                const result = await addBackup(session);
                log(
                  "Backup passkey added",
                  "Backup access is enabled on the same wallet.",
                  result.hash,
                );
                download(result.kit);
              } finally {
                update();
              }
            })
          }
        >
          Add a backup passkey
        </button>
        {session.access === "backup" && (
          <p>
            Use your primary passkey to add another backup or enable a limited
            session. You can send payments with this backup.
          </p>
        )}
        {kits.map((kit) => (
          <div className="backup-row" key={kit.permissionId}>
            <span>Backup {kit.permissionId}</span>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => download(kit)}
            >
              Download recovery file
            </button>
            <button
              className="text-button"
              disabled={busy || blocked || session.access !== "primary"}
              onClick={() =>
                run(async () => {
                  const hash = await removePermission(
                    session,
                    kit.permissionId,
                  );
                  localStorage.setItem(
                    "tidewater:backup-passkeys:v1",
                    JSON.stringify(
                      recoveryKits().filter(
                        (k) =>
                          k.permissionId !== kit.permissionId ||
                          k.account !== kit.account,
                      ),
                    ),
                  );
                  log(
                    "Backup access removed",
                    "This backup can no longer authorize new operations.",
                    hash,
                  );
                  update();
                })
              }
            >
              Remove backup
            </button>
          </div>
        ))}
      </section>
      <section className="panel account-panel">
        <h2>Optional payment session</h2>
        <p>
          Approve once with your passkey. Then send one payment of up to €1,000
          to Kessler, spending at most 1,500 USDC. Access expires after 15
          minutes. Other transfers and account changes are blocked onchain.
        </p>
        <p>
          The temporary key stays in this tab’s memory and is discarded when you
          sign out or reload.
        </p>
        {limited ? (
          <>
            <p role="status">
              {limited.used
                ? "Session payment used. Authorize a new session to pay again."
                : Date.now() >= limited.expiresAt
                  ? "Session expired."
                  : `Session ready until ${new Date(limited.expiresAt).toLocaleTimeString()}.`}
            </p>
            <button
              className="button secondary"
              disabled={busy || blocked}
              onClick={() =>
                run(async () => {
                  const enabled = await limited.wallet.validator.isEnabled(
                    session.account.address,
                    "0x",
                  );
                  if (enabled) {
                    const hash = await removePermission(
                      session,
                      limited.permissionId,
                      limited.wallet.validator,
                    );
                    log(
                      "Payment session revoked",
                      "The temporary permission was removed onchain.",
                      hash,
                    );
                  }
                  onLimited(null);
                })
              }
            >
              End payment session
            </button>
          </>
        ) : (
          <button
            className="button secondary"
            disabled={busy || blocked || session.access !== "primary"}
            onClick={() =>
              run(async () => {
                onLimited(await enableLimitedSession(session));
                log(
                  "Payment session approved",
                  "One supplier payment · €1,000 / 1,500 USDC caps · 15 minutes. No private key is saved.",
                );
              })
            }
          >
            Enable limited session
          </button>
        )}
      </section>
      <section className="panel account-panel">
        <h2>Live rate-protection demo</h2>
        <p>
          This presenter action makes a real test-token swap to move the shared
          pool price by about 0.5%. It checks that the old invoice fails its
          0.3% price cap, then swaps back. It mints extra test tokens and
          requires passkey approval for both swaps.
        </p>
        <p>
          The protected invoice is checked by the actual contract without
          broadcasting a failing invoice. Successful price-change and
          restoration transactions appear in Activity.
        </p>
        <button
          className="button secondary"
          disabled={busy || blocked || restoreNeeded}
          onClick={() =>
            run(async () => {
              try {
                await runRateDemo(session, log);
              } finally {
                update();
              }
            })
          }
        >
          Run live rate-protection demo
        </button>
        {restoreNeeded && (
          <div className="alert">
            <p>
              A rate demo needs restoration. Check any pending operation first,
              then restore the test pool before making another payment.
            </p>
            <button
              className="button secondary"
              disabled={busy || blocked}
              onClick={() =>
                run(async () => {
                  try {
                    const hash = await restorePool(session);
                    log(
                      "Test pool restored",
                      "The reverse test swap completed.",
                      hash ?? undefined,
                    );
                  } finally {
                    update();
                  }
                })
              }
            >
              Restore test pool
            </button>
          </div>
        )}
        <a
          className="text-button"
          href={explorerUrl(
            "0x52b6ad5d5c1abe391738b8ef5f7b830361703ea07cc29f845dfe4c386c7a36fe",
          )}
          target="_blank"
          rel="noreferrer"
        >
          Earlier confirmed demo payment
        </a>
      </section>
    </div>
  );
}
