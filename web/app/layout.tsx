import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AuspeX — human-gated prediction markets on MST",
  description:
    "AI proposes. Humans and the chain decide. Prediction markets created under human authority, with AI agents bounded by a deterministic policy gate and on-chain limits.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-ink-950 text-ink-100 antialiased">{children}</body>
    </html>
  );
}
