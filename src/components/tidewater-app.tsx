"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  ArrowLeftRight,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  ExternalLink,
  Fingerprint,
  FileUp,
  KeyRound,
  UserRoundPlus,
  Globe2,
  History,
  House,
  Landmark,
  LoaderCircle,
  LogOut,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Waves,
  X,
} from "lucide-react";
import {
  INITIAL_BALANCE,
  formatMoney,
  formatUnits6,
  formatTokenUnits,
  paymentActivities,
  mergeActivity,
  parseEuroAmount,
  previewQuote,
  validatePayment,
  type Activity,
  type Quote,
} from "@/lib/payment";
import { explorerUrl, paymentConfigured, walletConfigured } from "@/lib/config";
import { RateComparison } from "./rate-comparison";
import type { ReferenceRate } from "@/lib/rates";
import { getPublicPoolQuote } from "@/lib/public-quote";
import type { WalletSession } from "@/lib/wallet";
import type { LimitedSession } from "@/lib/security";
import {
  loadPending,
  checkOperation,
  OperationPendingError,
  OperationRevertedError,
  type PendingOperation,
} from "@/lib/operations";
import dynamic from "next/dynamic";
const AccountControls = dynamic(
  () => import("./account-controls").then((m) => m.AccountControls),
  { ssr: false },
);

type View = "home" | "send" | "activity" | "account";
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const names: Record<View, string> = {
  home: "Overview",
  send: "Send payment",
  activity: "Activity",
  account: "Account & security",
};
const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message.split("\n")[0]
    : "Something went wrong. Please try again.";

function Brand({ light = false }: { light?: boolean }) {
  return (
    <div className={`brand ${light ? "brand-light" : ""}`}>
      <span className="brand-icon">
        <Waves size={25} strokeWidth={2.6} />
      </span>
      <span>
        tidewater<span className="brand-pay">pay</span>
      </span>
    </div>
  );
}

function Simulated() {
  return <span className="simulated">Simulated</span>;
}

export function TidewaterApp() {
  const [mode, setMode] = useState<"preview" | "live" | null>(null);
  const [session, setSession] = useState<WalletSession | null>(null);
  const [view, setView] = useState<View>("home");
  const [balance, setBalance] = useState(INITIAL_BALANCE);
  const [rate, setRate] = useState<ReferenceRate>({
    usdPerEuro: 1.08,
    usdPerUsdc: null,
    usdcPerEuro: null,
    source: "Illustrative reference rate",
    live: false,
    updatedAt: null,
  });
  const [amount, setAmount] = useState("1000");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [overviewQuote, setOverviewQuote] = useState<Quote | null>(null);
  const [overviewQuoteLoading, setOverviewQuoteLoading] = useState(false);
  const [overviewQuoteError, setOverviewQuoteError] = useState("");
  const [busy, setBusy] = useState(false);
  const [authAction, setAuthAction] = useState<
    "signin" | "create" | "recover" | null
  >(null);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryFileName, setRecoveryFileName] = useState("");
  const [confirmationUnknown, setConfirmationUnknown] = useState(false);
  const [pending, setPending] = useState<PendingOperation | null>(null);
  const [limited, setLimited] = useState<LimitedSession | null>(null);
  const [passkeySupported, setPasskeySupported] = useState(true);
  const [contactOpen, setContactOpen] = useState(false);
  const [error, setError] = useState("");
  const [quoteError, setQuoteError] = useState("");
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [protectedOnce, setProtectedOnce] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [progress, setProgress] = useState(-1);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [filter, setFilter] = useState("all");
  const [now, setNow] = useState(0);
  const [completed, setCompleted] = useState<{
    amount: bigint;
    spent: bigint;
    seconds: number;
    hash?: `0x${string}`;
  } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const contactDialog = useRef<HTMLDialogElement>(null);
  const request = useRef(0);
  const overviewRequest = useRef(0);
  const submitLock = useRef(false);
  const historyRequest = useRef(0);
  const recoveryInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPasskeySupported(
      Boolean(window.PublicKeyCredential && navigator.credentials),
    );
    let active = true;
    const updateRate = () =>
      fetch("/api/rates")
        .then((r) => r.json())
        .then((data) => {
          if (active) setRate(data);
        })
        .catch(() => {});
    void updateRate();
    const interval = setInterval(() => {
      void updateRate();
    }, 60_000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      active = false;
      clearInterval(interval);
      clearInterval(clock);
    };
  }, []);

  useEffect(() => {
    if (completed) dialog.current?.showModal();
  }, [completed]);

  useEffect(() => {
    if (contactOpen) contactDialog.current?.showModal();
  }, [contactOpen]);

  function log(item: Omit<Activity, "id" | "time">) {
    setActivity((old) => [
      { ...item, id: crypto.randomUUID(), time: Date.now() },
      ...old.filter(
        (previous) =>
          !item.hash ||
          previous.hash !== item.hash ||
          previous.kind !== item.kind,
      ),
    ]);
  }

  async function refreshHistory(account: WalletSession["account"]["address"]) {
    const current = ++historyRequest.current;
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const entries = await (
        await import("@/lib/payment-history")
      ).readPaymentHistory(account);
      if (current === historyRequest.current)
        setActivity((old) => mergeActivity(old, entries));
    } catch {
      if (current === historyRequest.current)
        setHistoryError(
          "Recent onchain payments could not be loaded. Refresh payment history to try again.",
        );
    } finally {
      if (current === historyRequest.current) setHistoryLoading(false);
    }
  }

  const refreshOverviewQuote = useCallback(async () => {
    if (!mode) return;
    const current = ++overviewRequest.current;
    setOverviewQuoteLoading(true);
    setOverviewQuoteError("");
    try {
      const next =
        mode === "live"
          ? await (await import("@/lib/chain")).getPoolQuote(1_000_000_000n)
          : paymentConfigured
            ? await getPublicPoolQuote(1_000_000_000n)
            : previewQuote(1_000_000_000n, 1.08);
      if (current === overviewRequest.current) setOverviewQuote(next);
    } catch {
      if (current === overviewRequest.current) {
        setOverviewQuote(null);
        setOverviewQuoteError(
          "The pool quote could not be loaded. Try refreshing it.",
        );
      }
    } finally {
      if (current === overviewRequest.current) setOverviewQuoteLoading(false);
    }
  }, [mode]);
  useEffect(() => {
    if (view !== "home" || !mode) return;
    void refreshOverviewQuote();
    const timer = setInterval(() => {
      if (document.visibilityState !== "hidden") void refreshOverviewQuote();
    }, 25_000);
    return () => {
      clearInterval(timer);
      overviewRequest.current++;
    };
  }, [view, mode, refreshOverviewQuote]);

  const refreshQuote = useCallback(async () => {
    const current = ++request.current;
    setQuote(null);
    setQuoteError("");
    setQuoteLoading(true);
    try {
      const euros = parseEuroAmount(amount);
      const next =
        mode === "live"
          ? await (await import("@/lib/chain")).getPoolQuote(euros)
          : paymentConfigured
            ? await getPublicPoolQuote(euros)
            : previewQuote(euros, 1.08);
      if (current === request.current) {
        setQuote(next);
        setNeedsRefresh(false);
      }
    } catch (e) {
      if (current === request.current) setQuoteError(errorMessage(e));
    } finally {
      if (current === request.current) setQuoteLoading(false);
    }
  }, [amount, mode]);

  useEffect(() => {
    if (view !== "send" || !mode || (mode === "live" && !paymentConfigured))
      return;
    const id = setTimeout(() => {
      void refreshQuote();
    }, 300);
    return () => {
      clearTimeout(id);
      request.current += 1;
    };
  }, [view, mode, refreshQuote]);

  async function signIn(register: boolean, recoveryFile?: string) {
    if (submitLock.current) return;
    submitLock.current = true;
    setBusy(true);
    setAuthAction(recoveryFile ? "recover" : register ? "create" : "signin");
    setError("");
    try {
      const wallet = recoveryFile
        ? await (await import("@/lib/security")).recoverWithFile(recoveryFile)
        : await (await import("@/lib/wallet")).connectPasskey(register);
      setSession(wallet);
      setActivity([]);
      const saved = loadPending(wallet.account.address);
      setPending(saved);
      setConfirmationUnknown(Boolean(saved));
      setLimited(null);
      setOverviewQuote(null);
      setMode("live");
      setView("home");
      setBalance(0n);
      if (paymentConfigured)
        setBalance(
          await (
            await import("@/lib/chain")
          ).readBalance(wallet.account.address),
        );
      if (paymentConfigured) await refreshHistory(wallet.account.address);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      setAuthAction(null);
      submitLock.current = false;
    }
  }

  function enterPreview() {
    setOverviewQuote(null);
    historyRequest.current++;
    setHistoryLoading(false);
    setHistoryError("");
    setLimited(null);
    setPending(null);
    setMode("preview");
    setSession(null);
    setBalance(INITIAL_BALANCE);
    setView("home");
    setError("");
    setProtectedOnce(false);
    setConfirmationUnknown(false);
    setNeedsRefresh(false);
    setQuote(null);
    setProgress(-1);
    setCompleted(null);
    setActivity([
      {
        id: crypto.randomUUID(),
        kind: "funding",
        title: "Account funded",
        detail: "Bank deposit · Plaid",
        amount: INITIAL_BALANCE,
        time: Date.now(),
        simulated: true,
      },
    ]);
  }

  async function refreshBalance() {
    if (!session || busy) return;
    setBusy(true);
    setError("");
    try {
      setBalance(
        await (
          await import("@/lib/chain")
        ).readBalance(session.account.address),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function fundAccount() {
    if (!session || submitLock.current) return;
    submitLock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await (
        await import("@/lib/wallet")
      ).fundTestAccount(session);
      setBalance(result.balance);
      log({
        kind: "funding",
        title: "Test account funded",
        detail: "Simulated bank deposit · test tokens minted onchain",
        amount: INITIAL_BALANCE,
        simulated: true,
        hash: result.hash,
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      syncPending();
      setBusy(false);
      submitLock.current = false;
    }
  }

  async function pay() {
    if (submitLock.current || !quote || needsRefresh || confirmationUnknown)
      return;
    submitLock.current = true;
    setBusy(true);
    setError("");
    setCompleted(null);
    const started = performance.now();
    try {
      validatePayment(quote, balance);
      if (session && (await import("@/lib/rate-demo")).rateDemoState(session))
        throw new Error(
          "Restore the test pool from Account & security before paying.",
        );
      if (
        limited &&
        (limited.used ||
          Date.now() >= limited.expiresAt ||
          quote.eurAmount > 1_000_000_000n ||
          quote.maxUsdcAmount > 1_500_000_000n)
      )
        throw new Error(
          "This payment is outside the limited session. End it or authorize a new session from Account & security.",
        );
      if (mode === "preview" && !protectedOnce) {
        await pause(650);
        const reason =
          "Rate moved 0.5%, more than the 0.3% allowed. Nothing was sent.";
        setProtectedOnce(true);
        setNeedsRefresh(true);
        setError(reason);
        log({
          kind: "blocked",
          title: "Payment protected",
          detail: reason,
          simulated: true,
        });
        return;
      }
      setProgress(0);
      let spent = quote.usdcAmount;
      let hash: `0x${string}` | undefined;
      if (mode === "live" && session) {
        const result = await (
          await import("@/lib/wallet")
        ).sendPayment(
          limited?.wallet ?? session,
          quote,
          () => {
            setProgress(1);
            setPending(loadPending(session.account.address));
          },
          limited?.invoiceId,
        );
        setPending(null);
        if (limited) setLimited({ ...limited, used: true });
        hash = result.hash;
        spent = result.spent;
        setBalance(result.balance ?? balance - spent);
      } else {
        await pause(650);
        setProgress(1);
        await pause(650);
        setBalance((old) => old - spent);
      }
      setProgress(2);
      paymentActivities({
        euros: quote.eurAmount,
        dollars: spent,
        hash,
        simulated: mode === "preview",
      }).forEach(log);
      await pause(700);
      setProgress(3);
      log({
        kind: "payout",
        title: "Supplier bank payout",
        detail: "EURC → EUR · Kessler’s bank",
        amount: quote.eurAmount,
        simulated: true,
      });
      setCompleted({
        amount: quote.eurAmount,
        spent,
        seconds: (performance.now() - started) / 1000,
        hash,
      });
      setQuote(null);
      setNeedsRefresh(true);
      setView("activity");
    } catch (e) {
      const message = errorMessage(e);
      if (limited && e instanceof OperationRevertedError)
        setLimited({ ...limited, used: true });
      setError(message);
      setProgress(-1);
      setNeedsRefresh(true);
      if (e instanceof OperationPendingError) {
        setConfirmationUnknown(true);
        setPending(e.operation);
        setError(e.message);
      } else {
        setPending(session ? loadPending(session.account.address) : null);
        setConfirmationUnknown(
          Boolean(session && loadPending(session.account.address)),
        );
      }
      log({
        kind: "blocked",
        title: mode === "live" ? "Payment not completed" : "Payment protected",
        detail: message,
        simulated: mode === "preview",
        hash:
          e instanceof OperationRevertedError ? e.transactionHash : undefined,
      });
    } finally {
      setBusy(false);
      submitLock.current = false;
    }
  }

  function syncPending() {
    if (!session) return;
    const saved = loadPending(session.account.address);
    setPending(saved);
    setConfirmationUnknown(Boolean(saved));
  }
  async function runAccountAction(task: () => Promise<void>) {
    if (submitLock.current) return;
    submitLock.current = true;
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      syncPending();
      if (session)
        setBalance(
          await (
            await import("@/lib/chain")
          )
            .readBalance(session.account.address)
            .catch(() => balance),
        );
      setBusy(false);
      submitLock.current = false;
    }
  }
  async function checkStatus() {
    await runAccountAction(async () => {
      if (!session) return;
      const { paymentEvidence } = await import("@/lib/wallet");
      let recoveredSpent: bigint | undefined;
      const result = await checkOperation(session, (pending, receipt) => {
        if (pending.kind === "payment")
          recoveredSpent = paymentEvidence(
            session,
            receipt,
            BigInt(pending.eurAmount || "0"),
            BigInt(pending.maxUsdcAmount || "0"),
          ).spent;
      });
      if (!result) return;
      const hash = result.receipt.receipt.transactionHash;
      if (!result.receipt.success) {
        if (limited && result.pending.kind === "payment")
          setLimited({ ...limited, used: true });
        log({
          kind: "blocked",
          title: "Operation reverted",
          detail:
            "Confirmed onchain. Its changes were rolled back; you can refresh the quote and retry.",
          simulated: false,
          hash,
        });
        setNeedsRefresh(true);
        return;
      }
      if (result.pending.kind === "payment" && recoveredSpent !== undefined) {
        paymentActivities({
          euros: BigInt(result.pending.eurAmount!),
          dollars: recoveredSpent,
          hash,
          simulated: false,
          title: "Payment confirmed",
        }).forEach(log);
      } else
        log({
          kind: "security",
          title:
            result.pending.kind === "payment"
              ? "Payment confirmed"
              : "Operation confirmed",
          detail:
            result.pending.kind === "payment"
              ? `${formatMoney(BigInt(result.pending.eurAmount || "0"), "EUR")} invoice confirmed onchain. Do not pay it again.`
              : "The saved operation completed on Arbitrum Sepolia.",
          simulated: false,
          amount: recoveredSpent,
          hash,
        });
      if (limited && result.pending.kind === "payment")
        setLimited({ ...limited, used: true });
      setNeedsRefresh(true);
      setQuote(null);
    });
  }

  const paid = activity
    .filter((a) => a.kind === "payment")
    .reduce((sum, item) => sum + (item.amount || 0n), 0n);
  const paidCount = activity.filter((a) => a.kind === "payment").length;
  const expired = Boolean(quote && (now || Date.now()) >= quote.expiresAt);
  const insufficient = Boolean(quote && balance < quote.maxUsdcAmount);
  const navigation = [
    { id: "home" as const, icon: House, label: "Overview" },
    { id: "send" as const, icon: Send, label: "Send payment" },
    { id: "activity" as const, icon: History, label: "Activity" },
    ...(mode === "live"
      ? [
          {
            id: "account" as const,
            icon: ShieldCheck,
            label: "Account & security",
          },
        ]
      : []),
  ];

  function navigate(next: View) {
    if (!busy) {
      setView(next);
      setError("");
    }
  }

  if (!mode)
    return (
      <main className="login-page">
        <section className="login-story">
          <Brand light />
          <div className="story-content">
            <span className="eyebrow light">
              <span className="dot" /> BUILT FOR BUSINESS, WITHOUT BORDERS
            </span>
            <h1>
              Your business.
              <br />A world of
              <br />
              <em>possibilities.</em>
            </h1>
            <p>
              From your shop to their workshop.
              <br />
              Make international payments feel local.
            </p>
            <div className="story-route">
              <span>
                US <b>Raman Home</b>
              </span>
              <span className="route-line">
                <ArrowRight size={18} />
              </span>
              <span>
                DE <b>Kessler Werkstätten</b>
              </span>
            </div>
          </div>
          <div className="story-footer">
            <ShieldCheck size={17} /> Powered by Arbitrum & ZeroDev
          </div>
          <div className="water water-one" />
          <div className="water water-two" />
        </section>
        <section className="login-panel">
          <span className="network-pill">
            <span className="dot" /> ARBITRUM SEPOLIA · TESTNET
          </span>
          <div className="login-card">
            <span className="login-wave">
              <Waves size={32} />
            </span>
            <h2>A little closer to everywhere.</h2>
            <p>
              Welcome to Tidewater Pay.
              <br />
              Sign in securely to pay your suppliers.
            </p>
            <div className="identity">
              <span className="avatar">PR</span>
              <span>
                <b>Priya Raman</b>
                <small>Raman Home · United States</small>
              </span>
              <ShieldCheck size={19} />
            </div>
            <button
              className="button primary full"
              disabled={!walletConfigured || busy || !passkeySupported}
              onClick={() => void signIn(false)}
            >
              {authAction === "signin" ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <Fingerprint size={20} />
              )}{" "}
              Sign in with a passkey <ArrowRight size={18} />
            </button>
            {walletConfigured && (
              <div className="account-entry-options">
                <button
                  className="create-account-option"
                  aria-label="Create a new account"
                  disabled={busy || !passkeySupported}
                  onClick={() => void signIn(true)}
                >
                  <span className="account-option-icon">
                    <UserRoundPlus size={20} />
                  </span>
                  <span className="account-option-copy">
                    <b>Create a new account</b>
                    <small>A fresh wallet with a new passkey</small>
                  </span>
                  {authAction === "create" ? (
                    <LoaderCircle size={17} className="spin" />
                  ) : (
                    <ArrowRight size={17} className="account-option-arrow" />
                  )}
                </button>
                <p className="account-return-note">
                  Already have a wallet? Sign in above to keep the same address.
                </p>
                <section
                  className={`recovery-card ${recoveryOpen ? "is-open" : ""}`}
                  aria-label="Backup passkey recovery"
                >
                  <button
                    type="button"
                    className="recovery-toggle"
                    aria-label="Recover with a backup passkey"
                    aria-expanded={recoveryOpen}
                    aria-controls="recovery-options"
                    disabled={busy}
                    onClick={() => setRecoveryOpen((open) => !open)}
                  >
                    <span className="recovery-key">
                      <KeyRound size={18} />
                    </span>
                    <span className="account-option-copy">
                      <b>Recover with a backup passkey</b>
                      <small>Get back to your existing wallet</small>
                    </span>
                    <ChevronDown size={17} className="recovery-chevron" />
                  </button>
                  <div
                    id="recovery-options"
                    className="recovery-options"
                    hidden={!recoveryOpen}
                  >
                    <p id="recovery-file-hint">
                      Choose your saved recovery file. We’ll ask for your backup
                      passkey next.
                    </p>
                    <button
                      type="button"
                      className="recovery-file-picker"
                      aria-label="Choose recovery file"
                      aria-describedby="recovery-file-hint"
                      disabled={busy || !passkeySupported}
                      onClick={() => recoveryInput.current?.click()}
                    >
                      <span className="recovery-upload-icon">
                        {authAction === "recover" ? (
                          <LoaderCircle size={20} className="spin" />
                        ) : (
                          <FileUp size={20} />
                        )}
                      </span>
                      <span className="recovery-file-copy">
                        <b>
                          {authAction === "recover"
                            ? "Opening your backup passkey…"
                            : recoveryFileName || "Choose recovery file"}
                        </b>
                        <small>
                          {recoveryFileName
                            ? "Select a different file"
                            : "Select the .json file you saved"}
                        </small>
                      </span>
                      <span className="recovery-file-type">JSON</span>
                    </button>
                    <input
                      ref={recoveryInput}
                      className="recovery-file-input"
                      aria-label="Import recovery file"
                      tabIndex={-1}
                      type="file"
                      accept=".json,application/json"
                      disabled={busy || !passkeySupported}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setRecoveryFileName(file.name);
                          void file
                            .text()
                            .then((text) => signIn(false, text))
                            .catch((e) => setError(errorMessage(e)));
                        }
                        e.target.value = "";
                      }}
                    />
                  </div>
                </section>
              </div>
            )}
            {!passkeySupported && (
              <p role="alert">
                This browser does not support passkeys. Open the demo in a
                current browser with a device lock enabled, or explore the
                preview.
              </p>
            )}
            {!walletConfigured && (
              <p className="setup-note">
                Testnet sign-in will be available when the demo’s wallet
                connection is configured.
              </p>
            )}
            {error && (
              <div className="alert error" role="alert">
                {error}
              </div>
            )}
            <div className="login-divider">
              <span>or take a look around</span>
            </div>
            <button
              className="button secondary full"
              onClick={enterPreview}
              disabled={busy}
            >
              Explore the interactive demo <ArrowRight size={17} />
            </button>
            <p className="preview-note">
              Preview uses simulated balances and payments.
              <br />
              No real money. No account needed.
            </p>
          </div>
          <div className="login-bottom">
            <ShieldCheck size={15} /> Secure by design. Simple by nature.
          </div>
        </section>
      </main>
    );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="workspace">
          <span className="workspace-icon">
            rh
            <span />
          </span>
          <span>
            <b>Raman Home</b>
            <small>Business account</small>
          </span>
          <ChevronDown size={15} />
        </div>
        <span className="nav-heading">WORKSPACE</span>
        <nav aria-label="Main navigation">
          {navigation.map((item) => (
            <button
              key={item.id}
              aria-current={view === item.id ? "page" : undefined}
              className={`nav-item ${view === item.id ? "active" : ""}`}
              onClick={() => navigate(item.id)}
              disabled={busy}
            >
              <item.icon size={19} />
              {item.label}
              {item.id === "send" && (
                <span className="nav-shortcut">
                  <ArrowUpRight size={13} />
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="support-card">
            <span className="support-icon">
              <Globe2 size={22} />
            </span>
            <b>A world within reach.</b>
            <p>
              One payment. Fewer borders.
              <br />
              More room to grow.
            </p>
            <button
              className="text-button support-link"
              onClick={() => setContactOpen(true)}
            >
              <CircleHelp size={14} /> About this demo
            </button>
          </div>
          <button
            className="profile"
            disabled={busy}
            onClick={() => {
              historyRequest.current++;
              setHistoryLoading(false);
              setHistoryError("");
              setMode(null);
              setSession(null);
              setLimited(null);
              setPending(null);
              setQuote(null);
              setActivity([]);
              setCompleted(null);
              setError("");
            }}
          >
            <span className="avatar">PR</span>
            <span>
              <b>Priya Raman</b>
              <small>Raman Home</small>
            </span>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={13} />
            <b>{names[view]}</b>
          </div>
          <div className="topbar-right">
            <span className="network-pill">
              <span className="dot" /> Arbitrum Sepolia
            </span>
            <span className={`mode-pill ${mode === "live" ? "live" : ""}`}>
              {mode === "preview" ? "Preview · simulated" : "Testnet"}
            </span>
            {mode === "preview" && (
              <button
                className="icon-button"
                aria-label="Reset preview"
                title="Reset preview"
                onClick={enterPreview}
                disabled={busy}
              >
                <RefreshCw size={17} />
              </button>
            )}
          </div>
        </header>
        <main className="main-content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">YOUR BUSINESS, CONNECTED</span>
              <h1>
                {view === "home"
                  ? "Good things cross borders."
                  : view === "send"
                    ? "Pay a world away."
                    : view === "account"
                      ? "Your account. Your control."
                      : "Every move, in one place."}
              </h1>
              <p>
                {view === "home"
                  ? "Welcome back, Priya. Here’s where your money stands."
                  : view === "send"
                    ? "You send dollars. Your supplier receives euros. We handle the in-between."
                    : view === "account"
                      ? "Keep access safe and choose how you approve payments."
                      : "A clear view of your payments, from start to finish."}
              </p>
            </div>
            {view === "home" && (
              <button
                className="button primary"
                onClick={() => navigate("send")}
              >
                <Plus size={18} /> New payment
              </button>
            )}
            {view === "activity" && (
              <button
                className="button secondary"
                onClick={() => navigate("send")}
              >
                New payment <ArrowUpRight size={17} />
              </button>
            )}
          </div>
          {mode === "preview" && (
            <div className="preview-banner">
              <Sparkles size={16} />
              <span>
                You’re exploring a demo. All balances, payments and bank
                connections are simulated.
              </span>
              <span className="banner-end">Resets on refresh</span>
            </div>
          )}
          {mode === "live" && !paymentConfigured && (
            <div className="alert" role="status">
              You’re signed in. Testnet payments will be available when the
              token, pool and supplier addresses are configured.
            </div>
          )}
          {mode === "live" && confirmationUnknown && (
            <div className="alert" role="status">
              <p>
                An operation is awaiting confirmation. Payments are paused to
                prevent duplicate sends, including after a reload.
              </p>
              {pending && (
                <p className="account-address">Operation: {pending.hash}</p>
              )}
              <button
                className="button secondary compact"
                disabled={busy}
                onClick={() => void checkStatus()}
              >
                Check operation status
              </button>
            </div>
          )}
          {mode === "live" && limited && (
            <div className="preview-banner">
              {limited.used
                ? "Limited session used. End it or approve a new session in Account & security."
                : "Limited session · one payment up to €1,000 · maximum 1,500 USDC · expires in 15 minutes from approval."}
            </div>
          )}
          {view === "account" && session && (
            <AccountControls
              session={session}
              busy={busy}
              blocked={confirmationUnknown}
              limited={limited}
              onLimited={setLimited}
              run={(task) => void runAccountAction(task)}
              log={(title, detail, hash) =>
                log({
                  kind:
                    title === "Rate protection verified"
                      ? "blocked"
                      : "security",
                  title,
                  detail,
                  hash,
                  simulated: false,
                })
              }
            />
          )}
          {mode === "live" &&
            paymentConfigured &&
            balance < INITIAL_BALANCE && (
              <div className="funding-banner">
                <div>
                  <Landmark size={18} />
                  <span>
                    <b>Start with a test deposit</b>
                    <small>
                      The bank connection is simulated. Your test-token balance
                      is onchain.
                    </small>
                  </span>
                </div>
                {process.env.NEXT_PUBLIC_ENABLE_TEST_FAUCET === "true" ? (
                  <button
                    className="button secondary compact"
                    disabled={busy || confirmationUnknown}
                    onClick={() => void fundAccount()}
                  >
                    {busy ? (
                      <LoaderCircle size={14} className="spin" />
                    ) : (
                      <Plus size={14} />
                    )}{" "}
                    Add 1,500 test USDC
                  </button>
                ) : (
                  <span>
                    Fund {session?.account.address} with test USDC, then refresh
                    your balance.
                  </span>
                )}
              </div>
            )}
          {error && view !== "send" && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}

          {view === "home" && (
            <>
              <div className="overview-grid">
                <section className="balance-card">
                  <div className="card-label">
                    <span>Available to send</span>
                    <span className="currency-token">$</span>
                  </div>
                  <div className="balance-number">
                    {formatUnits6(balance)} <span>USDC</span>
                  </div>
                  <div className="balance-caption">
                    <span className="dot" />{" "}
                    {mode === "preview"
                      ? "Your demo dollar balance"
                      : "Your onchain dollar balance"}
                  </div>
                  <div className="balance-bottom">
                    <span>
                      <Landmark size={15} /> Bank linked via Plaid <Simulated />
                    </span>
                    {mode === "live" && paymentConfigured && (
                      <button
                        className="icon-button"
                        title="Refresh balance"
                        aria-label="Refresh balance"
                        disabled={busy}
                        onClick={() => void refreshBalance()}
                      >
                        <RefreshCw size={16} className={busy ? "spin" : ""} />
                      </button>
                    )}
                  </div>
                </section>
                <section className="stat-card">
                  <span className="stat-icon">
                    <ArrowUpRight size={20} />
                  </span>
                  <span className="card-label">
                    {mode === "preview"
                      ? "Sent this session"
                      : "Recent payments"}
                  </span>
                  <strong>{formatMoney(paid)}</strong>
                  <span className="stat-foot">
                    {paidCount} {paidCount === 1 ? "payment" : "payments"} to
                    your suppliers
                  </span>
                </section>
                <section className="stat-card">
                  <span className="stat-icon mint">
                    <ShieldCheck size={20} />
                  </span>
                  <span className="card-label">Network fees you pay</span>
                  <strong>$0.00</strong>
                  <span className="stat-foot">
                    <span className="dot" /> Covered by Tidewater
                  </span>
                </section>
              </div>
              <div className="home-columns">
                <section className="panel suppliers-panel">
                  <div className="panel-header">
                    <div>
                      <h2>Your suppliers</h2>
                      <p>Good partnerships, a little closer.</p>
                    </div>
                    <span className="count-pill">01</span>
                  </div>
                  <div className="supplier-row">
                    <span className="supplier-avatar">
                      kw<span>DE</span>
                    </span>
                    <div className="supplier-name">
                      <b>Kessler Werkstätten</b>
                      <span>Woodworking workshop · Berlin, Germany</span>
                      <small>
                        <span className="dot" /> Saved supplier
                      </small>
                    </div>
                    <button
                      className="button secondary compact"
                      onClick={() => navigate("send")}
                    >
                      Pay supplier <ArrowUpRight size={16} />
                    </button>
                  </div>
                  <div className="invoice-strip">
                    <span>
                      <span className="invoice-icon">↗</span> Oak chairs ·
                      Invoice KW-2026-042
                    </span>
                    <b>
                      €1,000.00 <span>EUR</span>
                    </b>
                  </div>
                </section>
                <RateComparison
                  quote={overviewQuote}
                  reference={rate}
                  now={now}
                  loading={overviewQuoteLoading}
                  simulatedPayment={mode === "preview"}
                  poolPricing={paymentConfigured || mode === "live"}
                  compact
                  error={overviewQuoteError}
                  onRefresh={() => void refreshOverviewQuote()}
                />
              </div>
              <section className="panel">
                <div className="panel-header">
                  <div>
                    <h2>Recent activity</h2>
                    <p>Your latest moves, at a glance.</p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => navigate("activity")}
                  >
                    View all activity <ArrowRight size={15} />
                  </button>
                </div>
                <ActivityList items={activity.slice(0, 3)} />
              </section>
              <section className="journey-card">
                <span className="journey-globe">
                  <Globe2 size={28} />
                </span>
                <div>
                  <h2>Local money. Global possibilities.</h2>
                  <p>One simple payment, from your balance to your supplier.</p>
                </div>
                <div className="journey-mini">
                  <span>USD</span>
                  <i />
                  <span>USDC</span>
                  <i />
                  <span>EURC</span>
                  <i />
                  <span>EUR</span>
                </div>
              </section>
            </>
          )}

          {view === "send" && (
            <div className="payment-layout">
              <section className="panel payment-panel">
                <div className="panel-header">
                  <h2>Payment details</h2>
                  <span className="step-label">USD → EUR</span>
                </div>
                <div className="recipient-block">
                  <span className="supplier-avatar">
                    kw<span>DE</span>
                  </span>
                  <span>
                    <small>YOU’RE PAYING</small>
                    <b>Kessler Werkstätten</b>
                    <span>Berlin, Germany · Saved supplier</span>
                  </span>
                  <ShieldCheck size={21} />
                </div>
                <div className="payment-fields">
                  <label htmlFor="euro-amount">Your supplier receives</label>
                  <div className="amount-field">
                    <span>€</span>
                    <input
                      id="euro-amount"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={amount}
                      disabled={busy}
                      onChange={(event) => {
                        setAmount(event.target.value);
                        setQuote(null);
                        setError("");
                        setProgress(-1);
                      }}
                    />
                    <span className="currency-select">
                      <span className="flag-circle">EU</span> EUR
                    </span>
                  </div>
                  <div className="available-line">
                    Available balance <b>{formatUnits6(balance)} USDC</b>
                  </div>
                  <RateComparison
                    quote={quote}
                    reference={rate}
                    now={now}
                    loading={quoteLoading}
                    simulatedPayment={mode === "preview"}
                    poolPricing={paymentConfigured || mode === "live"}
                  />
                  <div className="quote-breakdown" aria-live="polite">
                    <div>
                      <span>Network fee</span>
                      <b className="green">
                        Covered by Tidewater <ShieldCheck size={14} />
                      </b>
                    </div>
                    <div>
                      <span>Rate protection</span>
                      <b>
                        0.3% above the {mode === "live" ? "Uniswap" : "preview"}{" "}
                        quote
                      </b>
                    </div>
                    <div className="quote-total">
                      <span>You send</span>
                      <strong>
                        {quote ? formatMoney(quote.usdcAmount) : "—"}{" "}
                        <small>USDC</small>
                      </strong>
                    </div>
                    {quote && (
                      <div className="max-line">
                        Maximum including rate allowance{" "}
                        <b>{formatMoney(quote.maxUsdcAmount)} USDC</b>
                      </div>
                    )}
                  </div>
                  <div className="quote-meta">
                    <span>
                      <Clock3 size={13} />{" "}
                      {quote
                        ? expired
                          ? "Quote expired"
                          : `Quote valid for ${Math.max(0, Math.ceil((quote.expiresAt - (now || Date.now())) / 1000))}s`
                        : "A fresh quote is needed"}
                    </span>
                    <button
                      className="text-button"
                      onClick={() => void refreshQuote()}
                      disabled={
                        busy ||
                        quoteLoading ||
                        (mode === "live" && !paymentConfigured)
                      }
                    >
                      <RefreshCw
                        size={13}
                        className={quoteLoading ? "spin" : ""}
                      />{" "}
                      Refresh quote
                    </button>
                  </div>
                  {quoteError && (
                    <div className="alert error" role="alert">
                      {quoteError}
                    </div>
                  )}
                  {insufficient && (
                    <div className="alert error" role="alert">
                      Not enough USDC for this payment, including the 0.3% rate
                      allowance.
                    </div>
                  )}
                  {error && (
                    <div className="alert error" role="alert">
                      <ShieldCheck size={19} />
                      <span>
                        {error}
                        {mode === "preview" && (
                          <small className="block-note">
                            Scripted protection example · no transaction
                            submitted
                          </small>
                        )}
                      </span>
                    </div>
                  )}
                  {mode === "preview" && !protectedOnce && (
                    <div className="protection-note">
                      <Sparkles size={15} /> The first preview payment
                      demonstrates protection against a bad rate.
                    </div>
                  )}
                  <button
                    className="button primary full pay-button"
                    disabled={
                      busy ||
                      !quote ||
                      expired ||
                      needsRefresh ||
                      insufficient ||
                      quoteLoading ||
                      confirmationUnknown
                    }
                    onClick={() => void pay()}
                  >
                    {busy ? (
                      <>
                        <LoaderCircle size={18} className="spin" />{" "}
                        {progress < 1
                          ? "Preparing payment…"
                          : "Completing payment…"}
                      </>
                    ) : (
                      <>
                        Send{" "}
                        {quote
                          ? formatMoney(quote.eurAmount, "EUR")
                          : "payment"}
                        <ArrowRight size={18} />
                      </>
                    )}
                  </button>
                  {needsRefresh && (
                    <p className="button-help">
                      Refresh your quote to{" "}
                      {completed ? "make another payment" : "try again"}.
                    </p>
                  )}
                  <p className="secure-caption">
                    <ShieldCheck size={14} />{" "}
                    {mode === "preview"
                      ? "Simulated payment · no money moves"
                      : "Securely approved with your ZeroDev passkey"}
                  </p>
                </div>
              </section>
              <aside className="payment-aside">
                <section className="panel route-panel">
                  <span className="eyebrow">THE WAY THERE</span>
                  <h2>
                    Four steps.
                    <br />
                    One seamless payment.
                  </h2>
                  <ol className="payment-route" aria-live="polite">
                    {[
                      {
                        title: "Dollars in",
                        desc: "Your bank funds your USDC balance",
                        simulated: true,
                      },
                      {
                        title: "Exchanged to euros",
                        desc: "USDC swapped for exact EURC",
                        simulated: mode === "preview",
                      },
                      {
                        title: "Delivered to Kessler",
                        desc: "Swap and delivery complete together",
                        simulated: mode === "preview",
                      },
                      {
                        title: "Paid out to their bank",
                        desc: "EURC becomes euros in their account",
                        simulated: true,
                      },
                    ].map((step, i) => (
                      <li
                        key={step.title}
                        className={progress >= i ? "done" : ""}
                      >
                        <span className="route-step">
                          {progress >= i ? <Check size={15} /> : i + 1}
                        </span>
                        <div>
                          <b>{step.title}</b>
                          <p>{step.desc}</p>
                          {step.simulated && <Simulated />}
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
                <div className="assurance">
                  <ShieldCheck size={23} />
                  <div>
                    <b>All together. Or not at all.</b>
                    <p>
                      If the exchange rate moves beyond your allowance, the swap
                      and delivery revert together.
                    </p>
                  </div>
                </div>
                <div className="invoice-note">
                  <small>PAYMENT REFERENCE</small>
                  <b>KW-2026-042</b>
                  <span>Oak chairs for Raman Home</span>
                </div>
              </aside>
            </div>
          )}

          {view === "activity" && (
            <section className="panel activity-panel">
              <div className="panel-header">
                <div>
                  <h2>Payment activity</h2>
                  <p>
                    Funding, Uniswap swaps, supplier payments, and safeguards.
                  </p>
                </div>
                <span className="count-pill">{activity.length}</span>
                {mode === "live" && session && (
                  <button
                    className="text-button"
                    disabled={busy || historyLoading}
                    onClick={() => void refreshHistory(session.account.address)}
                  >
                    <RefreshCw
                      size={14}
                      className={historyLoading ? "spin" : ""}
                    />{" "}
                    Refresh payment history
                  </button>
                )}
              </div>
              {mode === "live" && (
                <p className="history-note" role="status">
                  {historyLoading
                    ? "Loading confirmed swaps and supplier payments…"
                    : historyError ||
                      "Recent confirmed swaps and supplier payments are restored from Arbitrum Sepolia. Each pair shares one transaction."}
                </p>
              )}
              <div
                className="activity-filters"
                role="group"
                aria-label="Filter activity"
              >
                {[
                  { id: "all", label: "All activity" },
                  { id: "payment", label: "Payments" },
                  { id: "swap", label: "Swaps" },
                  { id: "blocked", label: "Protected" },
                  { id: "funding", label: "Funding" },
                ].map((f) => (
                  <button
                    key={f.id}
                    aria-pressed={filter === f.id}
                    onClick={() => setFilter(f.id)}
                    className={filter === f.id ? "selected" : ""}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <ActivityList
                items={activity.filter(
                  (a) => filter === "all" || a.kind === filter,
                )}
                detailed
              />
            </section>
          )}
          <footer className="app-footer">
            <span>
              <Waves size={15} /> Money moves. Your business grows.
            </span>
            <span>
              Arbitrum Sepolia · Test funds only{" "}
              <span className="footer-separator">/</span> Powered by ZeroDev
            </span>
          </footer>
        </main>
      </div>
      <dialog
        ref={contactDialog}
        className="contact-card"
        aria-labelledby="contact-title"
        onClose={() => setContactOpen(false)}
      >
        <button
          className="icon-button dialog-close"
          aria-label="Close demo information"
          onClick={() => contactDialog.current?.close()}
        >
          <X size={20} />
        </button>
        <Waves size={30} />
        <h2 id="contact-title">Meet Tidewater Pay.</h2>
        <p>
          A fictional payment company demonstrating cross-border payments with
          ZeroDev and Arbitrum. All funds are test tokens. Bank connections and
          payouts are simulated.
        </p>
        <p>
          This is a demonstration of the payment experience. No real bank
          deposit or bank payout takes place.
        </p>
        <button
          className="button primary full"
          autoFocus
          onClick={() => contactDialog.current?.close()}
        >
          Back to the demo
        </button>
      </dialog>
      <dialog
        ref={dialog}
        className="completion-dialog"
        onClose={() => setCompleted(null)}
        aria-labelledby="completion-title"
      >
        <button
          className="dialog-close icon-button"
          aria-label="Close payment summary"
          onClick={() => dialog.current?.close()}
        >
          <X size={20} />
        </button>
        <span className="completion-icon">
          <CheckCheck size={32} />
        </span>
        <span className="eyebrow">A GOOD DAY TO GO GLOBAL</span>
        <h2 id="completion-title">Delivered. Just like that.</h2>
        <p>
          {completed && formatMoney(completed.amount, "EUR")}{" "}
          {mode === "preview" ? "delivery previewed" : "tEURC delivered"} to
          Kessler Werkstätten.
        </p>
        {completed && (
          <div className="swap-receipt">
            <b>
              {mode === "preview"
                ? "Uniswap v3 swap · simulated"
                : "Uniswap v3 swap · confirmed"}
            </b>
            <span>
              {formatTokenUnits(completed.spent)} tUSDC <ArrowRight size={15} />{" "}
              {formatTokenUnits(completed.amount)} tEURC
            </span>
            <small>
              {mode === "preview"
                ? "Exchange and delivery are simulated."
                : "The swap and supplier delivery completed together in one transaction."}
            </small>
          </div>
        )}
        <div className="summary-grid">
          <div>
            <b>{completed?.seconds.toFixed(1)}s</b>
            <span>
              {mode === "preview" ? "Simulated journey" : "Payment journey"}
            </span>
          </div>
          <div>
            <b>{activity.filter((a) => a.kind === "blocked").length}</b>
            <span>Attempts protected</span>
          </div>
          <div>
            <b>$0</b>
            <span>Fees paid by you</span>
          </div>
        </div>
        <div className="completion-note">
          <ShieldCheck size={17} />
          <span>
            {mode === "preview"
              ? "All steps in this preview are simulated."
              : "Network fees sponsored by Tidewater on Arbitrum Sepolia."}
            <br />
            The supplier’s bank payout is simulated.
          </span>
        </div>
        {completed?.hash && (
          <a
            className="text-button receipt-link"
            href={explorerUrl(completed.hash)}
            target="_blank"
            rel="noreferrer"
          >
            View swap & payment transaction <ExternalLink size={14} />
          </a>
        )}
        {completed?.hash && (
          <code className="receipt-hash">{completed.hash}</code>
        )}
        <button
          className="button primary full"
          onClick={() => dialog.current?.close()}
        >
          View activity <ArrowRight size={17} />
        </button>
        <button
          className="text-button summary-cta"
          onClick={() => {
            dialog.current?.close();
            const url = process.env.NEXT_PUBLIC_ENTERPRISE_CONTACT_URL;
            if (url && /^https:\/\//.test(url))
              window.open(url, "_blank", "noopener,noreferrer");
            else setContactOpen(true);
          }}
        >
          Explore Tidewater for your business <ArrowUpRight size={13} />
        </button>
      </dialog>
    </div>
  );
}

function ActivityList({
  items,
  detailed = false,
}: {
  items: Activity[];
  detailed?: boolean;
}) {
  if (!items.length)
    return (
      <div className="empty-state">
        <History size={28} />
        <h3>A fresh start.</h3>
        <p>Your activity will appear here when you make a payment.</p>
      </div>
    );
  return (
    <div className="activity-list">
      {items.map((item) => (
        <div
          className={`activity-row ${detailed ? "detailed" : ""}`}
          key={item.id}
        >
          <span className={`activity-icon ${item.kind}`}>
            {item.kind === "blocked" ? (
              <ShieldCheck size={19} />
            ) : item.kind === "funding" ? (
              <ArrowDownLeft size={20} />
            ) : item.kind === "payout" ? (
              <Landmark size={18} />
            ) : item.kind === "swap" ? (
              <ArrowLeftRight size={19} />
            ) : (
              <ArrowUpRight size={20} />
            )}
          </span>
          <div className="activity-description">
            <b>
              <span>{item.title}</span> {item.simulated && <Simulated />}
            </b>
            <span>{item.detail}</span>
            {item.kind === "swap" && item.hash && (
              <small className="shared-transaction">
                Same transaction as supplier payment
              </small>
            )}
            {item.hash && (
              <div className="activity-receipt">
                <a
                  href={explorerUrl(item.hash)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {item.kind === "swap"
                    ? "View Uniswap swap transaction"
                    : item.kind === "payment"
                      ? "View supplier payment transaction"
                      : "View transaction"}{" "}
                  <ExternalLink size={12} />
                </a>
                <code>{item.hash}</code>
              </div>
            )}
          </div>
          <div className="activity-amount">
            {item.swap ? (
              <b>{formatTokenUnits(item.swap.eurcAmount)} tEURC</b>
            ) : item.amount !== undefined ? (
              <b className={item.kind === "funding" ? "green" : ""}>
                {item.kind === "funding"
                  ? "+"
                  : item.kind === "payment"
                    ? "−"
                    : ""}
                {formatMoney(
                  item.amount,
                  item.kind === "payout" ? "EUR" : "USD",
                )}
              </b>
            ) : item.kind === "blocked" ? (
              <span className="protected-pill">Protected</span>
            ) : (
              <span className="protected-pill">Account</span>
            )}
            <small>
              {new Date(item.time).toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
              })}
            </small>
          </div>
        </div>
      ))}
    </div>
  );
}
