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
      <head>
        {/*
          Google's Photorealistic 3D Tiles (Tiles.tsx) are the very first cross-origin
          fetches the app makes once a key is present, and there are thousands of them
          over one preload -- paying the DNS + TLS + HTTP/2 handshake for the FIRST one
          rather than the one after it is a real, free head start. Next.js hoists a
          Server Component's own <link> into <head> automatically; no next/head needed
          in the App Router. `crossOrigin` matches how the tile fetches themselves run
          (CORS mode, GoogleCloudAuthPlugin's session token in the request, not cookies),
          since a preconnect without it only covers same-mode requests.
        */}
        <link rel="preconnect" href="https://tile.googleapis.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://tile.googleapis.com" />
      </head>
      <body>{children}</body>
    </html>
  );
}
