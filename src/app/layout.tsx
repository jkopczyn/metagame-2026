import type { Metadata } from "next";
import {
  Bebas_Neue,
  Inter,
  Roboto,
  Space_Grotesk,
  Space_Mono,
} from "next/font/google";
import BootSync from "@/v2/components/BootSync";
import UtmCapture from "@/v2/components/UtmCapture";
import { Toaster } from "@/v2/components/ui/sonner";
import { PUZZLE_BOOT_SCRIPT } from "@/v2/puzzle/boot";
import "./globals.css";

const bebasNeue = Bebas_Neue({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-bebas",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
});

const inter = Inter({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-inter",
});

const spaceMono = Space_Mono({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-space-mono",
});

// Button label font (baked into the shared shadcn Button base classes).
const roboto = Roboto({
  weight: ["500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-roboto",
});

const DESCRIPTION =
  "A convention of games, designs, and puzzles. Nov 6-8, 2026 at Lighthaven, Berkeley, California.";

export const metadata: Metadata = {
  // Absolute URLs for the social preview image (src/app/opengraph-image.jpg
  // + twitter-image.jpg, picked up by file convention) — Discord, Slack and
  // Twitter need them absolute.
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || "https://metagame.games",
  ),
  title: "Metagame — Nov 6-8, 2026",
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "Metagame",
    title: "Metagame 2026 — Nov 6-8, Berkeley",
    description: DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Metagame 2026 — Nov 6-8, Berkeley",
    description: DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      // globals.css sets scroll-behavior: smooth; this tells Next so it can
      // disable it during route transitions instead of warning.
      data-scroll-behavior="smooth"
      className={`${bebasNeue.variable} ${spaceGrotesk.variable} ${inter.variable} ${spaceMono.variable} ${roboto.variable} h-full antialiased`}
    >
      <head>
        {/* Before-first-paint boot: a plain inline script is the only thing
            that runs synchronously before paint (next/script's
            beforeInteractive is executed by an async client chunk). React
            reuses this node on hydration. If hydration ever *fails* and React
            client-renders the root, it recreates (but can't run) the script,
            logs "Encountered a script tag while rendering", and strips every
            attribute off <html> — BootSync (below) restores them. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              // Saved ticket currency (localStorage is client-only, so the
              // server can't know it) — keeps the tickets toggle from
              // flashing USD→BTC.
              `try{var c=localStorage.getItem('ticket-currency');document.documentElement.dataset.currency=c==='btc'?'btc':'usd'}catch(e){document.documentElement.dataset.currency='usd'}` +
              // Hero puzzle pick — see src/v2/puzzle/boot.ts.
              PUZZLE_BOOT_SCRIPT,
          }}
        />
      </head>
      <body className="flex min-h-full flex-col">
        <BootSync />
        <UtmCapture />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
