import type { Metadata } from "next";
import { Bricolage_Grotesque, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/**
 * Three faces, each with a job.
 *
 * **Bricolage Grotesque** for display. It has real character — slightly compressed, a little
 * odd in the details — which is what the brief asked for and what a default grotesque cannot
 * give. It appears only at headline sizes, where personality reads as confidence rather than
 * noise.
 *
 * **Inter** for prose. Most of this site is argument: what a gate refused and why, what a
 * signature does and does not prove. That wants a face chosen for reading at 15px, not one
 * chosen to be interesting.
 *
 * **JetBrains Mono** for every hash, address, wei value, function name and column name. This is
 * not a stylistic preference: the product exists so that a reader can compare a string on this
 * page against the same string on MSTScan, and a proportional face makes `0` and `O` a guess.
 * The previous theme set mono as the default for everything, which made the prose harder to read
 * for no benefit; it is now reserved for the data it is legible for.
 *
 * Self-hosted by `next/font`, so there is no request to Google at runtime and no layout shift
 * from a late-arriving face. `display: "swap"` means text is readable before the webfont lands.
 */

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AuspeX — human-gated prediction markets on MST",
  description:
    "AI proposes. Humans and the chain decide. Prediction markets created under human authority, with AI agents bounded by a deterministic policy gate and on-chain limits.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${bricolage.variable} ${inter.variable} ${jetbrains.variable}`}>
      <body className="min-h-dvh bg-ink-950 font-sans text-ink-100 antialiased">{children}</body>
    </html>
  );
}
