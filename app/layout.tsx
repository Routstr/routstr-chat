import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { roomFontVariables } from "@/components/v2/fonts";

const ROOM_BOOT = `try{if(location.pathname.indexOf("/classic")!==0){var d=document.documentElement,r=localStorage.getItem("routstr.room")||"auto";if(r==="auto")r=matchMedia("(prefers-color-scheme: dark)").matches?"night":"paper";d.dataset.room=r;if(!localStorage.getItem("routstr.firstlight"))d.dataset.firstlight="";if(r==="meridian"){var h=new Date().getHours();d.dataset.face=h>=6&&h<18?"day":"dusk"}}}catch(e){}`;
import "./globals.css";
import ClientProviders from "@/components/ClientProviders";
import { Toaster } from "@/components/ui/sonner";
import BitcoinConnectClient from "@/components/bitcoin-connect/BitcoinConnectClient";
import SWUpdater from "@/components/SWUpdater";
import { GlobalTooltip } from "@/components/ui/GlobalTooltip";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Routstr",
  description:
    "The future of AI access is permissionless, private, and decentralized",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
    shortcut: "/icons/icon-192.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Routstr",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#111111",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={roomFontVariables} suppressHydrationWarning>
      <head>
        {/* the room (and a first visit) is known before the first paint, so there is no flash */}
        <script dangerouslySetInnerHTML={{ __html: ROOM_BOOT }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
        suppressHydrationWarning={true}
      >
        <ClientProviders>
          <SWUpdater />
          {children}
          <Toaster />
          <GlobalTooltip />
          <BitcoinConnectClient />
        </ClientProviders>
      </body>
    </html>
  );
}
