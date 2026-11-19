process.loadEnvFile(".env.local");
const origin = process.argv[2];
if (!origin || !/^https?:\/\//.test(origin))
  throw new Error("Pass the app origin to check.");
const endpoint = process.env.NEXT_PUBLIC_ZERODEV_PASSKEY_SERVER_URL;
if (!endpoint) throw new Error("Configure the passkey-server URL first.");
try {
  const response = await fetch(`${endpoint}/register/options`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({
      username: "Tidewater domain configuration check",
      ...(process.argv.includes("--explicit-rpid")
        ? { rpID: new URL(origin).hostname }
        : {}),
    }),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  console.log(
    JSON.stringify(
      {
        origin,
        status: response.status,
        allowedOrigin: response.headers.get("access-control-allow-origin"),
        relyingPartyDomain: result.options?.rp?.id ?? null,
        appHostname: new URL(origin).hostname,
      },
      null,
      2,
    ),
  );
} catch {
  console.error(
    "Passkey origin check failed; endpoint and credential payloads were not logged.",
  );
  process.exitCode = 1;
}
