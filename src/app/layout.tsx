import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tidewater Pay · Money without borders",
  description:
    "Pay your international suppliers with confidence. A cross-border payments testnet demo powered by Arbitrum and ZeroDev.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
