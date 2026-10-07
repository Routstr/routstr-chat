import { MetadataRoute } from "next";
import { withBase } from "@/lib/base";

// Required for static export with Next.js when using output: "export"
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Routstr",
    short_name: "Routstr",
    description:
      "The future of AI access is permissionless, private, and decentralized",
    start_url: withBase("/"),
    scope: withBase("/"),
    id: withBase("/"),
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#111111",
    icons: [
      {
        src: withBase("/icons/apple-touch-icon.png"),
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
      {
        src: withBase("/icons/icon-192.png"),
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: withBase("/icons/icon-512.png"),
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: withBase("/icons/maskable-512.png"),
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
