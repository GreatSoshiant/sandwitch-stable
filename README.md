# Tidewater Pay

A responsive cross-border payment web demo: Priya at Raman Home pays Kessler Werkstätten’s €1,000 invoice. Built with Next.js, TypeScript, viem, ZeroDev Kernel 3.3 passkey accounts, and Uniswap v3.

Source: [Cross Border Stablecoin Payout spec](https://app.notion.com/p/40d01a3f59f88085aac2faa94e910ddb), reread before implementation. The user selected **Arbitrum Sepolia** for phase one. The web app is live in the Offchain Labs Vercel workspace at **https://tidewater-pay.vercel.app**. The hosted end-to-end test passed: passkey registration, sponsored test funding, exact delivery of 1,000 test EURC, and returning sign-in. The live rate endpoint also passes. The production passkey domain is configured.

## Present the demo to the team

Open **https://tidewater-pay.vercel.app**.

1. To create a separate wallet, select **Create a new account**. Approve the device prompt. Returning users select **Sign in with a passkey**.
2. Select **Add 1,500 test USDC**. The bank deposit is simulated, while the test-token mint is a real sponsored onchain operation.
3. Select **New payment**. Leave the supplier amount at **€1,000**, review the executable pool quote and select **Send €1,000.00**. Approve the passkey prompt.
4. The summary links to the actual Arbitrum Sepolia transaction. The swap and supplier delivery are real; the final bank payout is simulated.
5. Sign out and sign back in to see the same onchain balance. Add more test USDC when needed to repeat the demo.

Use **Account & security → Run live rate-protection demo** to move the actual test pool by about 0.5%, check rejection of an invoice capped at 0.3%, and reverse the price-change swap. The failed invoice is verified with a contract simulation; it is not broadcast or given a fabricated transaction hash. The two successful pool transactions appear in Activity. **Explore the interactive demo** also retains the deterministic simulated journey. All tokens are test-only. The dedicated Tidewater chain and USDC-native gas are excluded from this work.

## Live Arbitrum Sepolia deployment

| Component                     | Address                                      |
| ----------------------------- | -------------------------------------------- |
| Test dollar token (tUSDC)     | `0xfe300e67e35904b062849651e3409ef30518fb61` |
| Test euro token (tEURC)       | `0x7a77eab652ee22f29647cbde23b27c30338fb661` |
| Uniswap v3 factory            | `0x2448cd83251ca9f5e2a20009c1f494b8f7c2dec0` |
| SwapRouter                    | `0x9867c0f990779e8e03a93b01447a2387ced7dc1f` |
| QuoterV2                      | `0x03ae4004e070d15016b0a4f0feaf6a5abc7b7829` |
| Position manager              | `0x95aa3baef13405da787124a3d1b537f6b4fac92d` |
| USDC/tEURC pool (0.01%)       | `0x286D576d3c8f471E12DB1B806FcA483Ec79d1a88` |
| Invoice gateway               | `0x0d90c515a2bda3ec595173cbcba5d4cb2f5777e9` |
| Backup validator factory      | `0x8d1aa02266b090e8eab1471593d92ad6b6381e14` |
| Supplier Kernel smart account | `0xAc907DEecad0EEcdAE93Dd3E37b1a2142f594798` |

The pool was initialized at 1 EUR = 1.099 test USDC using the reference feed. Actual executable quotes include pool fee and price impact. Deployment, including the invoice gateway and backup factory, spent approximately 0.000458 test ETH. The immutable transaction journal is in `deployments/arbitrum-sepolia.json`; public verification evidence is in `deployments/passkey-payment-verification.json`. That live test used a disposable browser virtual authenticator, observed a nonzero EntryPoint paymaster, verified the sender held zero ETH, checked exactly 1,000 EURC arrived, and signed out and back in to the same balance. The final production domain has passed the automated test. Device-specific Face ID, Touch ID, PIN or security-key prompts are handled by each team member’s browser and device.

## Run the web app

Requires Node.js 22.12+ (tested with Node 24).

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:3000 and select **Explore the interactive demo**. No credentials are needed for preview. All preview balances, sign-in bypass, bank connections, swaps and payouts are explicitly simulated; preview never fabricates transaction hashes. Refreshing resets the session.

The preview has four screens: sign-in, overview, send, and activity. The first attempt demonstrates the scripted 0.5% adverse-rate movement, blocked by the 0.3% allowance. Refresh the quote and send again to finish the journey and see the summary. The summary uses the selected amount and measured duration.

## Connect real ZeroDev passkeys

Copy `.env.example` to `.env.local`. Set:

- `NEXT_PUBLIC_ZERODEV_RPC_URL`: the project's ZeroDev bundler/paymaster RPC URL for Arbitrum Sepolia.
- `NEXT_PUBLIC_ZERODEV_PASSKEY_SERVER_URL`: the project's passkey-server URL.
- In ZeroDev **Project → General → Passkeys → Domain**, enter the full origin **`https://tidewater-pay.vercel.app`** and select **Save Domain**. The current dashboard validates a full HTTP(S) URL, not a bare hostname. The server returns the hostname as the WebAuthn relying-party ID. Use a separate ZeroDev project for localhost development. Credentials created for one domain are not transferable to another.
- Enable gas sponsorship for this project's Arbitrum Sepolia operations. Fund sponsorship as required by the account's plan.

Restart Next.js after changing public environment values. Use **Create a new account** once, then **Sign in with a passkey**. This is wallet credential enrollment, not a new business signup or KYC flow. The app uses the direct passkey validator with Kernel 3.3 and EntryPoint 0.7, matching the spec. Passkey private keys stay in the authenticator. An optional session key exists only in tab memory. No private signing key is written to browser storage or the repository.

Public documentation: [passkeys](https://docs.zerodev.app/onboarding/passkeys/overview), [smart accounts](https://docs.zerodev.app/onboarding/create-a-smart-account), [batching](https://docs.zerodev.app/smart-accounts/batch-transactions).

## Configure the testnet payment

Set the six public addresses in `.env.local`: USDC, six-decimal test EURC, pool, router, QuoterV2 and supplier. The pool must be the configured tokens' **0.01% (fee 100)** Uniswap v3 pool. Use the original v3 `SwapRouter` ABI with a `deadline`, not `SwapRouter02`. The router, quoter and pool must share a factory; the app validates this and the chain ID before quoting/sending.

This deployment uses its own test EURC and test dollar token, both explicitly test-only. You can configure another six-decimal test EURC for a separate deployment. Circle's official Arbitrum Sepolia USDC is `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`; it is not the dollar token in the current demo pool.

Live payment flow:

1. Read the actual token balance and request an exact-output QuoterV2 quote for the EURC amount.
2. Compute the maximum USDC input with integer arithmetic: quoted amount plus 0.3%, rounded up. Quotes expire after 30 seconds.
3. Submit one sponsored atomic Kernel operation: clear and approve the invoice gateway’s bounded input, pay an invoice with a unique ID, and clear allowance. The immutable gateway swaps exact EURC to the saved supplier, clears router allowance, refunds unused USDC, and prevents paying the same account/invoice ID twice.
4. Verify the operation receipt and token delivery events; use the mined transaction hash for the Arbiscan link. If confirmation becomes uncertain after submission, further payments are paused to avoid a blind duplicate.
5. Record an explicitly simulated bank payout. The app does not send euros through a real bank.

Live mode never falls back to preview for payments. An unconfigured contract, missing liquidity, failed quote, insufficient balance, expired quote, rejected signature or failed sponsorship is shown as an error. Actual onchain balances persist across refresh; recent confirmed invoice payments and their Uniswap swaps are restored from gateway events when signing in. Bank simulations and other session-only activity reset. A public pending-operation record, backup lookup/recovery metadata and unfinished rate-demo restoration metadata persist locally. Pending operations block new sends until their receipt is checked; timeouts never automatically unlock a second payment. This resolves the spec's broad “everything resets” language without pretending blockchain state can reset.

## Deploy a demo exchange

The script deploys a standalone Uniswap v3 factory, original SwapRouter, QuoterV2, position manager, six-decimal demo dollar/euro tokens, an invoice gateway, a backup-validator factory and a funded 0.01% pool on Arbitrum Sepolia. It enables the fee tier, initializes the price using the CoinGecko reference when available (otherwise explicitly reports 1.08), and supplies full-range test liquidity. Position NFT metadata is intentionally unused. This test pool does **not** automatically follow real-world FX after initialization.

Put a funded **test-only** `DEPLOYER_PRIVATE_KEY` in ignored `.env.local`; never a `NEXT_PUBLIC_*` variable. The script accepts the 64-character hex key with or without `0x`. It checks chain ID 421614 before sending anything. Public deployment has completed; running it again resumes recorded successful steps rather than redeploying.

```sh
npm run deploy:demo
npm run verify:testnet
```

The script writes only the public deployment addresses into `.env.local`, preserving private values. Restart the app afterward. `npm run deploy:demo -- --check` makes read-only preflight requests. Deployment uses a conservative gas reserve and a default 0.02 test-ETH spending ceiling (`DEPLOYMENT_MAX_COST_ETH`). The journal records transaction hashes before broadcast, so ambiguous submissions stop without blindly sending replacements. Preserve the journal when resuming.

Set `EXISTING_EURC_ADDRESS` before a new deployment to reuse your token instead of deploying another; the deployer needs 1,000,000 tokens of that six-decimal test EURC to seed the supplied pool. This intentionally large test liquidity supports predictable €1,000 demonstrations. Change the script's seed amounts if your existing token supply is smaller, then assess price impact.

`NEXT_PUBLIC_ENABLE_TEST_FAUCET=true` enables the **Add 1,500 test USDC** action for this repository's permissionless demo token whenever the account has less than 1,500 test USDC. It submits a sponsored mint operation and labels the bank deposit simulated. This lets the team repeat the live payment with the same passkey. Leave this off for Circle's token or any token without the matching test faucet. Never use `DemoToken.sol` for real assets: anyone can mint test tokens.

By default the supplier is a deterministic ZeroDev Kernel 3.3 smart account at index 1, owned by the local deployer signer. It can receive tokens counterfactually before deployment. No supplier signing key is shipped to the browser or hosting provider. `NEXT_PUBLIC_SUPPLIER_ADDRESS` can override this for a separately supplied demo recipient.

## Vercel web deployment

The production project is `offchain-labs1/tidewater-pay`. Its stable URL is https://tidewater-pay.vercel.app. Public deployment metadata is recorded in `deployments/web-production.json`. CLI login is configured locally; no ChatGPT Vercel plugin is required.

`vercel.json` configures the Next.js build. `.vercelignore` allows only the application source and required build files; it excludes `.env.local`, deployment scripts, test recordings, journals, and `.git`. Do **not** upload `DEPLOYER_PRIVATE_KEY` to Vercel; the web app never needs it.

To update the linked project's public configuration, run `npm run vercel:env` (production) or `npm run vercel:env -- preview`. The script passes an explicit allowlist of public settings through stdin, never the deployer key. Then deploy using `npx vercel deploy --prod --scope offchain-labs1`. Do not change the final hostname casually: passkeys are bound to their relying-party domain.

To verify the hosted flow after configuring ZeroDev's passkey domain:

```sh
node scripts/check-passkey-origin.mjs https://tidewater-pay.vercel.app
TIDEWATER_TEST_BASE_URL=https://tidewater-pay.vercel.app npm run test:testnet
```

The domain check logs only the HTTP status, allowed origin and relying-party domain, not credential/challenge payloads. The live browser test fails early if the relying-party domain doesn't match the app hostname.

Configure only these environment variables in the Vercel project (Preview and Production), copying the public configuration from your local file:

- `NEXT_PUBLIC_ZERODEV_RPC_URL`
- `NEXT_PUBLIC_ZERODEV_PASSKEY_SERVER_URL`
- `NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL`
- `NEXT_PUBLIC_USDC_ADDRESS`, `NEXT_PUBLIC_EURC_ADDRESS`
- `NEXT_PUBLIC_SWAP_ROUTER_ADDRESS`, `NEXT_PUBLIC_QUOTER_ADDRESS`, `NEXT_PUBLIC_POOL_ADDRESS`
- `NEXT_PUBLIC_SUPPLIER_ADDRESS`, `NEXT_PUBLIC_ENABLE_TEST_FAUCET`
- `NEXT_PUBLIC_PAYMENT_GATEWAY_ADDRESS`, `NEXT_PUBLIC_BACKUP_VALIDATOR_FACTORY_ADDRESS`
- Optional `NEXT_PUBLIC_ENTERPRISE_CONTACT_URL`
- Optional server-only `COINGECKO_DEMO_API_KEY`

Choose a stable production hostname, allow its exact HTTPS origin in ZeroDev, and save the **full HTTPS origin** in the dashboard’s Passkeys → Domain field before team members register. Use the stable URL for passkeys; rotating Vercel preview subdomains create separate credential scopes. Local passkeys do not transfer to the production hostname. Never run `vercel env pull` over the deployer's `.env.local`; use a separate file if downloading hosting configuration.

## Reference rates

`GET /api/rates` gets EURC/USD and USDC/USD prices from CoinGecko and divides them to produce the EURC/USDC reference, revalidating at most once per minute. Optional `COINGECKO_DEMO_API_KEY` stays server-side. Stale/error responses are explicitly labeled illustrative. Live payment prices always come from the configured pool, never the external reference. A reference feed alone cannot keep a test pool's exchange price aligned with the real market.

## Spec decisions and phase boundary

| Spec detail                                                   | Implementation                                                                                                                                                                                  |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1,000 vs 1,500 USDC initial balance                           | Preview uses 1,500, following the Screens table, so a €1,000 invoice can be funded. Live mode reads the chain.                                                                                  |
| First 0.5% failure, then refresh/retry                        | Deterministic in preview; a separate live presenter control moves the actual pool, verifies the router cap with a contract call, then reverses the swap.                                        |
| ZeroDev wallet                                                | Direct passkey-signed Kernel 3.3 account, sponsored through ZeroDev.                                                                                                                            |
| Uniswap v3, 0.01%                                             | Self-deployment script plus exact-output integration. Existing matching deployments can be configured.                                                                                          |
| Bank/Plaid onboarding and bank payout                         | Simulated and labeled. No real banking, KYC, signup, or database.                                                                                                                               |
| Approximately two seconds                                     | Preview runs in about two seconds. Live summary measures actual duration; no promise about real bank settlement.                                                                                |
| WUSDC/native USDC gas                                         | Phase two. Phase one uses ERC-20 test USDC and sponsored native ETH gas on Arbitrum Sepolia.                                                                                                    |
| Dedicated Tidewater L3, USDC gas, bridge, Fireblocks treasury | Phase two; not deployed or claimed by this web-app implementation.                                                                                                                              |
| Enterprise CTA                                                | Set `NEXT_PUBLIC_ENTERPRISE_CONTACT_URL` to your actual HTTPS contact form. Without it, the CTA shows information about the fictional demo rather than sending to a fabricated company address. |

## Validation

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium firefox webkit
npm run test:e2e
TIDEWATER_TEST_BASE_URL=https://tidewater-pay.vercel.app npm run test:testnet
```

Twenty preview browser checks pass across Chromium desktop/mobile, Firefox, and WebKit desktop/iPhone emulation. They cover the protected-then-successful journey, summary, balance deduction, filters, refresh reset, invalid input, absence of fabricated receipts and viewport overflow.

`test:testnet` requires configured contracts, ZeroDev sponsorship and a passkey server configured for the target origin. Its default target is localhost; for the current production project run `TIDEWATER_TEST_BASE_URL=https://tidewater-pay.vercel.app npm run test:testnet`. Local full-wallet testing requires a separate project configured for localhost. It performs actual testnet funding/payment operations with a disposable browser authenticator and checks onchain delivery, the paymaster event and returning login. It disables traces/video to avoid recording credential payloads. It updates the public verification report only after the complete check passes.

With [Foundry / Anvil](https://getfoundry.sh/) installed:

```sh
npm run test:contracts
```

This starts a disposable local EVM on port 18545, deploys actual Uniswap v3 bytecode and the demo tokens, and executes the app's real quote/call builders through an atomic batch harness. It verifies exact supplier delivery, USDC debit, cleared allowances, full rollback on a spending-limit failure and onchain expiry. It does not replace a real ZeroDev passkey/paymaster test with your project configuration.

The production dependency audit is clean at implementation time. The development-only Vitest dependency tree still reports picomatch advisories; the registry currently has no patched picomatch version. A `tmp` override applies the available compiler-tooling fix. Do not run the test runner against untrusted glob input.

## Backup access, sessions and payment recovery

**Account & security** shows the current wallet address. Add a backup passkey while your primary passkey is available and download the recovery JSON. Choose another device/authenticator for an independent factor. Each backup uses its own deterministic EIP-1167 proxy to ZeroDev’s patched passkey validator, so it cannot overwrite the primary or another backup. Activation and removal are sponsored onchain operations. A backup has full wallet access, not just permission to log in.

On another browser, select **Recover with a backup passkey**, import the JSON, and authenticate with its matching passkey. The file only contains public information and cannot sign. Recovery restores the existing wallet address; it does not create a new wallet or change the primary key. Registration always creates a separate wallet. If every enrolled passkey and synced copy is lost, the public file alone cannot recover funds.

The optional session allows one operation within 15 minutes. Its call policy permits only USDC approval to the invoice gateway (up to 1,500 USDC) and the fixed session invoice (up to €1,000, up to 1,500 USDC, bounded deadline). The gateway fixes both tokens, pool fee and supplier, refunds unused input, and makes the invoice ID single-use. Timestamp and non-resetting count policies apply onchain. The session key and enable signature stay in memory. End an installed session to revoke its permission onchain; ending an unused session discards its local key. Reload/sign-out discard local session keys. A reverted included operation can still consume its one-operation allowance, so authorize a fresh session before retrying in that case.

Payment tracking prepares and signs once, computes the exact user-operation hash, saves it before broadcasting, and checks receipts without re-sending. Definitive validation rejections and confirmed execution reverts permit a fresh attempt; transport failures and receipt timeouts keep new sends locked. Successful payment receipts must show exact EURC delivery and a net USDC debit within the cap before the lock clears. Unknown operations are never unlocked just because time elapsed; a genuinely dropped operation may require checking the account nonce and bundler with an operator.

The rate-demo restoration record survives reload. If the flow is interrupted, check its pending operation, then choose **Restore test pool** before paying. Reverse swaps restore approximately the original price; swap fees and other participants’ trades mean an exact reset is not promised. This control is for the shared test pool only.

Additional checks:

```sh
npm run verify:permissions
TIDEWATER_TEST_BASE_URL=https://tidewater-pay.vercel.app npm run test:testnet
```

The permission verifier uses an ephemeral ECDSA owner to isolate onchain policy checks; browser tests separately verify passkey approval. Neither temporary private key nor WebAuthn credential material is included in verification reports. See `deployments/permission-verification.json`, `deployments/security-verification.json` and `deployments/connection-loss-verification.json` after successful runs.

Physical Face ID, Touch ID, Android passkey sync and roaming hardware-key checks require real devices. Follow [the device checklist](docs/device-checks.md); automated browser/device emulation is reported separately and does not prove hardware passkey behavior.

The final validation summary is in `deployments/validation-summary.json`. One hosted run received an isolated **Unauthorized** response from ZeroDev during returning sign-in; the focused recheck passed. If sign-in is rejected, try signing in again with the existing passkey. This does not re-submit a payment or create a new wallet.

## Swap receipts and restored payment history

Activity shows **USDC → EURC swap** as a separate step, including **Uniswap v3**, the 0.01% pool fee, exact six-decimal input/output amounts, and the full clickable transaction hash. The supplier-payment row uses that same hash because both actions execute atomically. Swap rows are excluded from sent totals, so the debit is counted once. The completion receipt also shows the exchange amounts and shared transaction hash. Preview exchange entries remain labeled simulated and have no fabricated hash.

Signing in restores the latest 25 confirmed payment transactions from the configured invoice gateway’s `InvoicePaid` events, including their swap rows. **Refresh payment history** loads them again without duplicates. These events are emitted only after the immutable gateway’s Uniswap exchange and exact supplier delivery succeed. Restoration never invents a bank payout. The optional `NEXT_PUBLIC_PAYMENT_HISTORY_START_BLOCK` defaults to `330494907`, the current team gateway’s deployment block. `deploy:demo` writes the matching block for future deployments; sync it together with a different gateway address.

## Uniswap price and market-reference comparison

The overview and payment form put the actual **Uniswap v3 exact-output quote** first: the average test USDC cost per test EURC for the displayed invoice, including the pool fee and price impact. The overview quotes the €1,000 example and refreshes every 25 seconds while visible. The payment form quotes the entered amount and uses that quote for execution.

A separate comparison shows the estimated USDC cost at CoinGecko’s EURC/USDC reference, plus the amount and percentage above or below it. The reference is calculated from both tokens’ USD prices, so USDC is not assumed to equal exactly one USD. It is a market benchmark, not a second executable quote. Test-pool prices can differ from market token prices.

Both CoinGecko token prices must be fresh (within 15 minutes) and valid. Missing/stale market data displays an unavailable comparison while the live pool quote remains independent. A fixed 1.08 illustrative preview is used only in local workspaces without configured payment contracts. On the configured demo, Preview fetches actual pool quotes independently of CoinGecko; a failed Uniswap lookup produces an unavailable quote and cannot fall back to the market reference. Reference updates do not refresh or replace a live payment quote. The 0.3% maximum-input allowance is measured above the Uniswap quote, not above the CoinGecko benchmark.

The comparison uses the base quoted input cost; the separate maximum input includes the 0.3% allowance. See `deployments/rate-comparison-verification.json` for browser verification with actual pool quotes and controlled reference fixtures; its provider status records the real public endpoint response. This check mints no test funds and sends no payment.

API references: [CoinGecko Simple Price](https://docs.coingecko.com/demo/reference/simple-price), [Uniswap v3 quoting](https://developers.uniswap.org/docs/sdks/v3/guides/swapping/quoting).

## Independent sources in Preview

Preview and live mode both show actual Uniswap pricing when the demo contracts are configured. Preview uses the public, uncached `GET /api/pool-quote?eurAmount=<six-decimal token units>` endpoint. That handler calls the deployed Uniswap Quoter directly and returns the pool and quoter addresses with the price. Live wallet mode continues to read the same Quoter through the configured RPC. Neither path derives its pool quote from CoinGecko.

`GET /api/rates` independently fetches CoinGecko's EURC and USDC market prices. If either provider is unavailable, its data is marked unavailable; the other source is not copied into its place. Equal prices can still occur naturally or after display rounding. Preview's balances, scripted first-attempt protection and payment execution remain simulated, even though its displayed pool pricing is a real read-only testnet quote.

The unauthenticated `preview-rates.spec.ts` check exercises the actual deployed endpoints without mocked sources, and verifies both the overview and amount-specific payment quotes. Its report is `deployments/preview-rate-independence-verification.json`. It sends no transaction and mints no tokens. Browser regression fixtures deliberately use different Uniswap and CoinGecko prices and test a Uniswap outage to prevent the original shared-source Preview behavior from returning.
