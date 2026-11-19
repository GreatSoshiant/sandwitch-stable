# Physical passkey checks

Use https://tidewater-pay.vercel.app. These checks remain manual until a team member completes them. Do not use real funds.

| Device/browser                                         | Status                      |
| ------------------------------------------------------ | --------------------------- |
| macOS Safari + Touch ID / system passkey               | Needs physical-device check |
| iPhone Safari + Face ID / synced passkey               | Needs physical-device check |
| Android Chrome + screen lock / Google Password Manager | Needs physical-device check |
| Windows Edge / Chrome + Windows Hello                  | Needs physical-device check |
| USB/NFC security key in a supported browser            | Needs physical-device check |

1. Create one new account; record its address from Account & security. Cancel a prompt once and verify that it returns to an error state without changing funds.
2. Add test funds and pay €10. Confirm the supplier transaction and sponsored fee.
3. Sign out and return with the same passkey. Check the same address and balance.
4. On a second device, select the existing synced passkey or the browser’s cross-device passkey option. Verify the same wallet; do not create a new account to attempt recovery.
5. Add a backup with another authenticator. Save its recovery file, then use a fresh browser profile to import it and sign with the matching backup. Check the original address and pay €10.
6. Return with the primary passkey, remove that backup, and verify that it cannot authorize another payment.
7. Enable a limited session, verify its caps and expiry text, pay once, then end it. Reload and verify no session remains active in the UI.
8. Record device, OS/browser versions, date and result here. Do not record private keys, passkey exports, biometric data or authenticator credential payloads.
