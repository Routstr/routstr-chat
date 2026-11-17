import type { Metadata } from "next";
import { withBase } from "@/lib/base";
import ChatPage from "../page";

/* A gift link opens here: the same app, but a chat app's preview of the link (WhatsApp, Signal)
   reads this page's card, never what comes after the #, where the gift itself is. */
const title = "You have a gift";
const description = "Sats to chat with any AI. No sign-up, no card: open it and start.";

export const metadata: Metadata = {
  metadataBase: new URL("https://chat.routstr.com"),
  title: `${title} · Routstr`,
  description,
  openGraph: { title, description, type: "website", images: [{ url: withBase("/gift-card.jpg"), width: 1200, height: 630, alt: "A gold bitcoin sign made of threads of light" }] },
  twitter: { card: "summary_large_image", title, description, images: [withBase("/gift-card.jpg")] },
};

export default ChatPage;
