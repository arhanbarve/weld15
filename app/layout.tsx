import type { Metadata } from "next";
import { IBM_Plex_Mono, Libre_Baskerville } from "next/font/google";
import "./globals.css";

// Self-hosted at build time by next/font. No CDN request, no layout shift.
// Mono carries labels, dimensions and every numeral; the serif carries prose.
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

const baskerville = Libre_Baskerville({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-baskerville",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Weld 15",
  description:
    "An interactive 3D model of Weld 15, Harvard Yard, built from Harvard's published building geometry.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${plexMono.variable} ${baskerville.variable}`}>
      <body>{children}</body>
    </html>
  );
}
